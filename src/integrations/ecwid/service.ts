import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { EcwidPaymentSessionStatus, PaymentTransactionStatus } from "@/generated/prisma/client";
import { calculatePlatformFeeMinor, createPaymentCheckoutForTransaction, refreshPaymentTransactionFromStripe } from "@/payments/service";
import { getDatabase } from "@/sentinel/db";
import { HttpError } from "@/sentinel/http";
import { childLogger } from "@/sentinel/logger";
import { updateEcwidPaymentStatus, EcwidApiError } from "./client";
import { ecwidEnabled, getEcwidConfiguration } from "./config";
import { ecwidTotalToMinorUnits } from "./money";
import { decryptEcwidReturnUrl, encryptEcwidReturnUrl } from "./storage";
import { createOrReuseEcwidStripeCheckout, expireEcwidStripeCheckout, retrieveEcwidStripeCheckout } from "./stripe-checkout";
import type { EcwidPaymentPayload, EcwidTargetStatus } from "./types";

const log = childLogger({ component: "ecwid-payments" });
const SESSION_TTL_MS = 24 * 60 * 60_000;
const SESSION_ID_PATTERN = /^orb_ps_[A-Za-z0-9_-]{32}$/;

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function ecwidSessionId() {
  return `orb_ps_${randomBytes(24).toString("base64url")}`;
}

function ecwidTransactionId() {
  return `orb_tx_${randomBytes(18).toString("base64url")}`;
}

function safeOrderKey(storeId: string, referenceTransactionId: string) {
  return `ecwid:${storeId}:${createHash("sha256").update(referenceTransactionId).digest("base64url").slice(0, 32)}`;
}

function validateReturnUrl(value: string, expectedClientId: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new HttpError(422, "Ecwid returned an invalid return URL"); }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) {
    throw new HttpError(422, "Ecwid returned an invalid return URL");
  }
  const clientId = url.searchParams.get("clientId") ?? url.searchParams.get("client_id");
  if (clientId && !safeEqual(clientId, expectedClientId)) throw new HttpError(422, "Ecwid return URL does not match this app");
  return value;
}

function assertPayloadAuthorized(payload: EcwidPaymentPayload) {
  const config = getEcwidConfiguration();
  if (!safeEqual(payload.storeId, config.storeId) || !safeEqual(payload.token, config.secretToken)) {
    throw new HttpError(403, "Ecwid payment request was not authorized");
  }
  return { config, returnUrl: validateReturnUrl(payload.returnUrl, config.clientId) };
}

function sessionSyncStatus(target: EcwidTargetStatus, succeeded: boolean): EcwidPaymentSessionStatus {
  if (target === "PAID") return succeeded ? "PAID_SYNCED" : "PAID_SYNC_PENDING";
  return succeeded ? "INCOMPLETE_SYNCED" : "INCOMPLETE_SYNC_PENDING";
}

function retryAt(attempt: number) {
  const delay = Math.min(60 * 60_000, 30_000 * 2 ** Math.min(attempt, 7));
  return new Date(Date.now() + delay);
}

function assertSessionMatchesRequest(
  session: { merchantId: string; storeId: string; orderId: string; amountMinor: number; currency: string },
  expected: { merchantId: string; storeId: string; orderId: string; amountMinor: number; currency: string },
) {
  if (
    session.merchantId !== expected.merchantId || session.storeId !== expected.storeId ||
    session.orderId !== expected.orderId || session.amountMinor !== expected.amountMinor || session.currency !== expected.currency
  ) throw new HttpError(409, "This Ecwid payment request conflicts with an existing session");
}

async function reuseEcwidPaymentSession(
  session: { id: string; merchantId: string; storeId: string; orderId: string; amountMinor: number; currency: string },
  expected: { merchantId: string; storeId: string; orderId: string; amountMinor: number; currency: string; returnUrl: string },
) {
  assertSessionMatchesRequest(session, expected);
  return getDatabase().ecwidPaymentSession.update({
    where: { id: session.id },
    data: { encryptedReturnUrl: encryptEcwidReturnUrl(expected.returnUrl, session.id) },
    include: { paymentTransaction: true },
  });
}

export function isEcwidSessionId(value: string) {
  return SESSION_ID_PATTERN.test(value);
}

export async function createOrReuseEcwidPaymentSession(payload: EcwidPaymentPayload) {
  const { config, returnUrl } = assertPayloadAuthorized(payload);
  const amountMinor = ecwidTotalToMinorUnits(payload.cart.order.total, payload.cart.currency);
  const currency = payload.cart.currency.toUpperCase();
  const referenceTransactionId = payload.cart.order.referenceTransactionId;
  const db = getDatabase();

  const existing = await db.ecwidPaymentSession.findUnique({
    where: { storeId_referenceTransactionId: { storeId: config.storeId, referenceTransactionId } },
    include: { paymentTransaction: true },
  });
  if (existing) {
    return reuseEcwidPaymentSession(existing, {
      merchantId: config.merchantId, storeId: config.storeId, orderId: payload.cart.order.id, amountMinor, currency, returnUrl,
    });
  }

  const merchant = await db.merchant.findUnique({
    where: { id: config.merchantId },
    select: {
      id: true,
      platformFeeBps: true,
      stripeConnect: { select: { stripeAccountId: true, cardPaymentsStatus: true } },
    },
  });
  if (!merchant) throw new HttpError(503, "The configured ORBIT merchant is unavailable");
  if (merchant.platformFeeBps === null) throw new HttpError(409, "Configure the merchant platform fee before accepting Ecwid payments");
  if (!merchant.stripeConnect || merchant.stripeConnect.cardPaymentsStatus?.toLowerCase() !== "active") {
    throw new HttpError(409, "STRIPE_NOT_READY");
  }
  const platformFeeMinor = calculatePlatformFeeMinor(amountMinor, merchant.platformFeeBps);
  if (platformFeeMinor <= 0 || platformFeeMinor >= amountMinor) throw new HttpError(422, "The configured application fee is invalid for this order total");

  const sessionId = ecwidSessionId();
  const transactionId = ecwidTransactionId();
  try {
    return await db.$transaction(async (tx) => {
      const paymentTransaction = await tx.paymentTransaction.create({
        data: {
          id: transactionId,
          merchantId: merchant.id,
          wooOrderId: safeOrderKey(config.storeId, referenceTransactionId),
          stripeAccountId: merchant.stripeConnect!.stripeAccountId,
          amountMinor,
          currency,
          platformFeeBps: merchant.platformFeeBps!,
          platformFeeMinor,
          status: "REQUIRES_PAYMENT",
          source: "ECWID",
          externalReference: referenceTransactionId,
        },
      });
      return tx.ecwidPaymentSession.create({
        data: {
          id: sessionId,
          merchantId: merchant.id,
          paymentTransactionId: paymentTransaction.id,
          storeId: config.storeId,
          orderId: payload.cart.order.id,
          referenceTransactionId,
          amountMinor,
          currency,
          customerEmail: payload.cart.order.email || null,
          encryptedReturnUrl: encryptEcwidReturnUrl(returnUrl, sessionId),
          checkoutMode: config.checkoutMode,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        },
        include: { paymentTransaction: true },
      });
    });
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) throw error;
    const concurrent = await db.ecwidPaymentSession.findUnique({
      where: { storeId_referenceTransactionId: { storeId: config.storeId, referenceTransactionId } },
      include: { paymentTransaction: true },
    });
    if (!concurrent) throw error;
    return reuseEcwidPaymentSession(concurrent, {
      merchantId: config.merchantId, storeId: config.storeId, orderId: payload.cart.order.id, amountMinor, currency, returnUrl,
    });
  }
}

export async function rejectEcwidPaymentRequest(payload: EcwidPaymentPayload, message: string) {
  const { config, returnUrl } = assertPayloadAuthorized(payload);
  const existing = await getDatabase().ecwidPaymentSession.findUnique({
    where: { storeId_referenceTransactionId: { storeId: config.storeId, referenceTransactionId: payload.cart.order.referenceTransactionId } },
    select: { id: true },
  });
  if (existing) throw new HttpError(409, "An existing Ecwid payment session cannot be rejected by a repeated request");
  await updateEcwidPaymentStatus(payload.cart.order.referenceTransactionId, "INCOMPLETE");
  const url = new URL(returnUrl);
  url.searchParams.set("errorMsg", message);
  return url.toString();
}

export async function getPublicEcwidCheckout(sessionId: string) {
  if (!isEcwidSessionId(sessionId)) throw new HttpError(404, "Payment session not found");
  const session = await getDatabase().ecwidPaymentSession.findUnique({
    where: { id: sessionId },
    include: {
      merchant: { select: { businessName: true } },
      paymentTransaction: { select: { status: true, stripePaymentIntentId: true } },
    },
  });
  if (!session) throw new HttpError(404, "Payment session not found");
  return {
    id: session.id,
    merchantName: session.merchant.businessName,
    amountMinor: session.amountMinor,
    currency: session.currency,
    email: session.customerEmail,
    paymentStatus: session.paymentTransaction.status,
    syncStatus: session.status,
    checkoutMode: session.checkoutMode,
    expired: session.expiresAt.getTime() <= Date.now() && session.paymentTransaction.status !== "SUCCEEDED",
  };
}

export async function createEcwidSessionCheckout(sessionId: string) {
  if (!isEcwidSessionId(sessionId)) throw new HttpError(404, "Payment session not found");
  const session = await getDatabase().ecwidPaymentSession.findUnique({
    where: { id: sessionId },
    select: { merchantId: true, paymentTransactionId: true, expiresAt: true, checkoutMode: true },
  });
  if (!session) throw new HttpError(404, "Payment session not found");
  if (session.checkoutMode !== "ORBIT_HOSTED") throw new HttpError(409, "This payment session uses Stripe Checkout");
  if (session.expiresAt.getTime() <= Date.now()) throw new HttpError(410, "This payment session has expired");
  return createPaymentCheckoutForTransaction(session.merchantId, session.paymentTransactionId, "ECWID");
}

export async function syncEcwidSession(sessionId: string, target: EcwidTargetStatus) {
  const db = getDatabase();
  const session = await db.ecwidPaymentSession.findUnique({
    where: { id: sessionId },
    include: { paymentTransaction: { select: { stripePaymentIntentId: true, status: true } } },
  });
  if (!session) throw new HttpError(404, "Payment session not found");
  if (target === "PAID" && session.status === "PAID_SYNCED") return { synced: true };
  if (target === "INCOMPLETE" && session.status === "INCOMPLETE_SYNCED") return { synced: true };
  if (target === "PAID" && session.paymentTransaction.status !== "SUCCEEDED") throw new HttpError(409, "Payment is not complete");
  const externalTransactionId = session.paymentTransaction.stripePaymentIntentId ?? (target === "INCOMPLETE" ? session.stripeCheckoutSessionId : null);
  if (!externalTransactionId) throw new HttpError(409, "Payment processor transaction is unavailable");

  try {
    await updateEcwidPaymentStatus(referenceForSync(session), target, externalTransactionId);
    await db.ecwidPaymentSession.update({
      where: { id: session.id },
      data: {
        status: sessionSyncStatus(target, true), ecwidPaymentStatus: target, syncAttempts: { increment: 1 },
        nextSyncAt: null, lastSyncErrorCode: null, syncedAt: new Date(),
      },
    });
    return { synced: true };
  } catch (error) {
    const attempts = session.syncAttempts + 1;
    const code = error instanceof EcwidApiError ? error.code : "ecwid_sync_error";
    await db.ecwidPaymentSession.update({
      where: { id: session.id },
      data: {
        status: sessionSyncStatus(target, false), ecwidPaymentStatus: target, syncAttempts: attempts,
        nextSyncAt: retryAt(attempts), lastSyncErrorCode: code.slice(0, 120), syncedAt: null,
      },
    });
    log.warn({ sessionId: session.id, transactionId: session.paymentTransactionId, target, errorCode: code }, "Ecwid payment status synchronization deferred");
    return { synced: false };
  }
}

function referenceForSync(session: { referenceTransactionId: string }) {
  return session.referenceTransactionId;
}

export async function refreshAndFinalizeEcwidSession(sessionId: string) {
  if (!isEcwidSessionId(sessionId)) throw new HttpError(404, "Payment session not found");
  const db = getDatabase();
  const session = await db.ecwidPaymentSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new HttpError(404, "Payment session not found");
  if (session.checkoutMode === "STRIPE_CHECKOUT") return refreshAndFinalizeStripeCheckout(session.id);
  const transaction = await refreshPaymentTransactionFromStripe(session.merchantId, session.paymentTransactionId, "ECWID");
  if (transaction.status === "SUCCEEDED") {
    const sync = await syncEcwidSession(session.id, "PAID");
    return { outcome: sync.synced ? "PAID" as const : "SYNC_PENDING" as const };
  }
  if (["PROCESSING", "REQUIRES_PAYMENT", "CREATED"].includes(transaction.status)) return { outcome: "PROCESSING" as const };
  const sync = await syncEcwidSession(session.id, "INCOMPLETE");
  return { outcome: sync.synced ? "INCOMPLETE" as const : "SYNC_PENDING" as const };
}

async function refreshAndFinalizeStripeCheckout(sessionId: string, cancelRequested = false) {
  const current = cancelRequested ? await expireEcwidStripeCheckout(sessionId) : await retrieveEcwidStripeCheckout(sessionId);
  const { session, checkout, intentId } = current;
  if ((checkout.payment_status === "paid" || checkout.payment_status === "no_payment_required") && intentId) {
    const transaction = await refreshPaymentTransactionFromStripe(session.merchantId, session.paymentTransactionId, "ECWID");
    if (transaction.status === "SUCCEEDED") {
      const sync = await syncEcwidSession(session.id, "PAID");
      return { outcome: sync.synced ? "PAID" as const : "SYNC_PENDING" as const };
    }
    await deferStripeCheckoutStatusCheck(session.id);
    return { outcome: "PROCESSING" as const };
  }
  if (checkout.status === "complete") {
    await getDatabase().paymentTransaction.updateMany({
      where: { id: session.paymentTransactionId, status: { notIn: ["SUCCEEDED", "CANCELED"] } },
      data: { status: "PROCESSING" },
    });
    await deferStripeCheckoutStatusCheck(session.id);
    return { outcome: "PROCESSING" as const };
  }
  if (checkout.status === "expired") {
    if (intentId) {
      const transaction = await refreshPaymentTransactionFromStripe(session.merchantId, session.paymentTransactionId, "ECWID");
      if (transaction.status === "SUCCEEDED") {
        const sync = await syncEcwidSession(session.id, "PAID");
        return { outcome: sync.synced ? "PAID" as const : "SYNC_PENDING" as const };
      }
      if (transaction.status === "PROCESSING") {
        await deferStripeCheckoutStatusCheck(session.id);
        return { outcome: "PROCESSING" as const };
      }
    }
    await getDatabase().paymentTransaction.updateMany({
      where: { id: session.paymentTransactionId, status: { not: "SUCCEEDED" } },
      data: { status: "CANCELED" },
    });
    const sync = await syncEcwidSession(session.id, "INCOMPLETE");
    return { outcome: sync.synced ? "INCOMPLETE" as const : "SYNC_PENDING" as const };
  }
  await deferStripeCheckoutStatusCheck(session.id);
  return { outcome: "PROCESSING" as const };
}

async function deferStripeCheckoutStatusCheck(sessionId: string) {
  await getDatabase().ecwidPaymentSession.updateMany({
    where: { id: sessionId, status: "PENDING" },
    data: { nextSyncAt: new Date(Date.now() + 5 * 60_000) },
  });
}

export async function cancelAndFinalizeEcwidSession(sessionId: string) {
  if (!isEcwidSessionId(sessionId)) throw new HttpError(404, "Payment session not found");
  const session = await getDatabase().ecwidPaymentSession.findUnique({ where: { id: sessionId }, select: { checkoutMode: true } });
  if (!session || session.checkoutMode !== "STRIPE_CHECKOUT") throw new HttpError(404, "Stripe Checkout payment session not found");
  return refreshAndFinalizeStripeCheckout(sessionId, true);
}

export async function ecwidPaymentRedirect(sessionId: string) {
  if (!isEcwidSessionId(sessionId)) throw new HttpError(404, "Payment session not found");
  const session = await getDatabase().ecwidPaymentSession.findUnique({ where: { id: sessionId }, select: { checkoutMode: true } });
  if (!session) throw new HttpError(404, "Payment session not found");
  if (session.checkoutMode === "ORBIT_HOSTED") return `/pay/${sessionId}`;
  const checkout = await createOrReuseEcwidStripeCheckout(sessionId);
  if (checkout.status !== "open" || checkout.paymentStatus === "paid" || checkout.paymentStatus === "no_payment_required") {
    return checkout.callbackUrl;
  }
  return checkout.url ?? checkout.callbackUrl;
}

export async function ecwidReturnUrl(sessionId: string, errorMessage?: string) {
  if (!isEcwidSessionId(sessionId)) throw new HttpError(404, "Payment session not found");
  const session = await getDatabase().ecwidPaymentSession.findUnique({ where: { id: sessionId }, select: { encryptedReturnUrl: true } });
  if (!session) throw new HttpError(404, "Payment session not found");
  const storedReturnUrl = decryptEcwidReturnUrl(session.encryptedReturnUrl, sessionId);
  if (!errorMessage) return storedReturnUrl;
  const url = new URL(storedReturnUrl);
  url.searchParams.set("errorMsg", errorMessage);
  return url.toString();
}

export async function syncEcwidForTransaction(transactionId: string, status: PaymentTransactionStatus) {
  const session = await getDatabase().ecwidPaymentSession.findUnique({ where: { paymentTransactionId: transactionId }, select: { id: true } });
  if (!session) throw new Error("ecwid_session_not_found");
  if (status === "SUCCEEDED") return syncEcwidSession(session.id, "PAID");
  if (status === "CANCELED") return syncEcwidSession(session.id, "INCOMPLETE");
  return { synced: false };
}

export async function reconcilePendingEcwidPayments(limit = 50) {
  if (!ecwidEnabled()) return { inspected: 0, completed: 0, pending: 0 };
  const now = new Date();
  const sessions = await getDatabase().ecwidPaymentSession.findMany({
    where: {
      status: { in: ["PAID_SYNC_PENDING", "INCOMPLETE_SYNC_PENDING"] },
      OR: [{ nextSyncAt: null }, { nextSyncAt: { lte: now } }],
    },
    orderBy: { updatedAt: "asc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
  let completed = 0;
  for (const session of sessions) {
    const target = session.status === "PAID_SYNC_PENDING" ? "PAID" : "INCOMPLETE";
    if ((await syncEcwidSession(session.id, target)).synced) completed += 1;
  }
  return { inspected: sessions.length, completed, pending: sessions.length - completed };
}

export async function reconcileExpiredEcwidStripeCheckouts(limit = 25) {
  if (!ecwidEnabled()) return { inspected: 0, completed: 0, pending: 0 };
  const now = new Date();
  const sessions = await getDatabase().ecwidPaymentSession.findMany({
    where: {
      checkoutMode: "STRIPE_CHECKOUT",
      stripeCheckoutSessionId: { not: null },
      stripeCheckoutExpiresAt: { lte: now },
      status: "PENDING",
      OR: [{ nextSyncAt: null }, { nextSyncAt: { lte: now } }],
    },
    orderBy: { updatedAt: "asc" },
    take: Math.min(Math.max(limit, 1), 50),
    select: { id: true },
  });
  let completed = 0;
  for (const session of sessions) {
    try {
      const result = await refreshAndFinalizeStripeCheckout(session.id);
      if (result.outcome === "PAID" || result.outcome === "INCOMPLETE") completed += 1;
    } catch (error) {
      await deferStripeCheckoutStatusCheck(session.id);
      log.warn({ sessionId: session.id, error }, "Stripe Checkout reconciliation deferred");
    }
  }
  return { inspected: sessions.length, completed, pending: sessions.length - completed };
}
