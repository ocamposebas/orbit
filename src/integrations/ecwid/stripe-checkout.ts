import type Stripe from "stripe";
import { paymentMethodConfigurationId } from "@/payments/service";
import { getServerEnv } from "@/sentinel/config";
import { getDatabase } from "@/sentinel/db";
import { HttpError } from "@/sentinel/http";
import { childLogger } from "@/sentinel/logger";
import { getStripeClient, getStripeConfiguration, stripeEnvironment } from "@/stripe/client";
import { getEcwidPublicCheckoutOrigin } from "./config";

const CHECKOUT_ID_PATTERN = /^cs_(?:test_|live_)?[A-Za-z0-9_]+$/;
const log = childLogger({ component: "ecwid-stripe-checkout" });

function mapStripeCheckoutError(error: unknown): never {
  if (error instanceof HttpError) throw error;
  const value = error as { type?: string; code?: string; statusCode?: number };
  const code = String(value.code ?? "unknown").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "unknown";
  log.error({ stripeErrorType: String(value.type ?? "unknown").slice(0, 80), stripeErrorCode: code, stripeStatusCode: value.statusCode }, "Stripe Checkout operation failed");
  if (value.type === "StripeAuthenticationError" || value.type === "StripePermissionError") throw new HttpError(503, "Stripe Checkout is not available for this connected account");
  if (value.type === "StripeRateLimitError" || value.statusCode === 429) throw new HttpError(429, "Stripe rate limited this request. Try again shortly.");
  if (value.type === "StripeInvalidRequestError" || value.statusCode === 400) throw new HttpError(422, "Stripe rejected the Checkout Session configuration");
  throw new HttpError(502, "Stripe Checkout is temporarily unavailable");
}

export function stripeCheckoutSessionIdempotencyKey(ecwidSessionId: string) {
  return `orbit-ecwid-checkout-${ecwidSessionId}`;
}

function paymentIntentId(value: Stripe.Checkout.Session["payment_intent"]) {
  return typeof value === "string" ? value : value?.id ?? null;
}

function callbackUrl(origin: string, path: string) {
  return new URL(path, `${origin}/`).toString();
}

function checkoutMetadata(session: {
  id: string;
  merchantId: string;
  storeId: string;
  orderId: string;
  referenceTransactionId: string;
  paymentTransactionId: string;
}) {
  return {
    orbitTransactionId: session.paymentTransactionId,
    orbitPaymentSessionId: session.id,
    merchantId: session.merchantId,
    ecwidStoreId: session.storeId,
    ecwidOrderId: session.orderId,
    ecwidReferenceTransactionId: session.referenceTransactionId,
    paymentSource: "ECWID",
  };
}

function assertCheckoutMatchesSession(
  checkout: Stripe.Checkout.Session,
  session: {
    id: string;
    merchantId: string;
    storeId: string;
    orderId: string;
    referenceTransactionId: string;
    paymentTransactionId: string;
    amountMinor: number;
    currency: string;
  },
) {
  const metadata = checkoutMetadata(session);
  if (!CHECKOUT_ID_PATTERN.test(checkout.id) || checkout.mode !== "payment") throw new HttpError(409, "Stripe Checkout returned an invalid session");
  if (checkout.amount_total !== session.amountMinor || checkout.currency?.toUpperCase() !== session.currency) {
    throw new HttpError(409, "Stripe Checkout does not match the stored Ecwid payment amount");
  }
  if (checkout.client_reference_id !== session.paymentTransactionId) throw new HttpError(409, "Stripe Checkout reference does not match ORBIT");
  for (const [key, value] of Object.entries(metadata)) {
    if (checkout.metadata?.[key] !== value) throw new HttpError(409, "Stripe Checkout metadata does not match ORBIT");
  }
}

async function attachCheckoutPaymentIntent(paymentTransactionId: string, checkout: Stripe.Checkout.Session) {
  const intentId = paymentIntentId(checkout.payment_intent);
  if (!intentId) return null;
  const db = getDatabase();
  await db.paymentTransaction.updateMany({
    where: { id: paymentTransactionId, source: "ECWID", stripePaymentIntentId: null },
    data: { stripePaymentIntentId: intentId },
  });
  const transaction = await db.paymentTransaction.findUnique({
    where: { id: paymentTransactionId },
    select: { stripePaymentIntentId: true },
  });
  if (transaction?.stripePaymentIntentId !== intentId) throw new HttpError(409, "Stripe Checkout PaymentIntent does not match ORBIT");
  return intentId;
}

async function loadStripeCheckoutRecord(sessionId: string) {
  const session = await getDatabase().ecwidPaymentSession.findUnique({
    where: { id: sessionId },
    include: {
      merchant: { select: { businessName: true, stripeConnect: { select: { stripeAccountId: true, stripeEnvironment: true, cardPaymentsStatus: true } } } },
      paymentTransaction: true,
    },
  });
  if (!session || session.checkoutMode !== "STRIPE_CHECKOUT") throw new HttpError(404, "Stripe Checkout payment session not found");
  const stripeConnect = session.merchant.stripeConnect;
  if (!stripeConnect || stripeConnect.stripeAccountId !== session.paymentTransaction.stripeAccountId) throw new HttpError(409, "The transaction's Stripe connected account is no longer available");
  if (stripeConnect.cardPaymentsStatus?.toLowerCase() !== "active") throw new HttpError(409, "STRIPE_NOT_READY");
  const stripeConfig = getStripeConfiguration();
  if (!stripeConfig.configured) throw new HttpError(503, "Stripe Connect is not configured");
  if (stripeConnect.stripeEnvironment !== stripeEnvironment(stripeConfig.mode)) throw new HttpError(409, "Stripe environment mismatch");
  return { session, stripeConnect };
}

export async function createOrReuseEcwidStripeCheckout(sessionId: string) {
  if (!getServerEnv().STRIPE_PAYMENTS_WEBHOOK_SECRET) throw new HttpError(503, "Stripe payment completion webhook is not configured");
  const { session, stripeConnect } = await loadStripeCheckoutRecord(sessionId);
  const stripe = getStripeClient();
  const requestOptions = { stripeContext: stripeConnect.stripeAccountId };

  let checkout: Stripe.Checkout.Session;
  if (session.stripeCheckoutSessionId) {
    try {
      checkout = await stripe.checkout.sessions.retrieve(session.stripeCheckoutSessionId, {}, requestOptions);
    } catch (error) {
      return mapStripeCheckoutError(error);
    }
  } else {
    const publicCheckoutOrigin = getEcwidPublicCheckoutOrigin();
    const metadata = checkoutMetadata(session);
    try {
      checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: session.paymentTransactionId,
      customer_email: session.customerEmail ?? undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: session.currency.toLowerCase(),
          unit_amount: session.amountMinor,
          product_data: { name: `Order from ${session.merchant.businessName}`.slice(0, 120), description: `Order ${session.orderId}` },
        },
      }],
      payment_method_configuration: paymentMethodConfigurationId(),
      payment_intent_data: {
        application_fee_amount: session.paymentTransaction.platformFeeMinor,
        metadata: { ...metadata, wooOrderId: session.paymentTransaction.wooOrderId },
      },
      metadata,
      success_url: callbackUrl(publicCheckoutOrigin, `/api/integrations/ecwid/return/${encodeURIComponent(session.id)}`),
      cancel_url: callbackUrl(publicCheckoutOrigin, `/api/integrations/ecwid/cancel/${encodeURIComponent(session.id)}`),
      }, { ...requestOptions, idempotencyKey: stripeCheckoutSessionIdempotencyKey(session.id) });
    } catch (error) {
      return mapStripeCheckoutError(error);
    }

    await getDatabase().ecwidPaymentSession.updateMany({
      where: { id: session.id, stripeCheckoutSessionId: null },
      data: { stripeCheckoutSessionId: checkout.id, stripeCheckoutExpiresAt: new Date(checkout.expires_at * 1_000) },
    });
    const stored = await getDatabase().ecwidPaymentSession.findUnique({ where: { id: session.id }, select: { stripeCheckoutSessionId: true } });
    if (stored?.stripeCheckoutSessionId !== checkout.id) throw new HttpError(409, "A different Stripe Checkout Session is already attached to this payment");
  }

  assertCheckoutMatchesSession(checkout, session);
  await attachCheckoutPaymentIntent(session.paymentTransactionId, checkout);
  return {
    id: checkout.id,
    url: checkout.url,
    status: checkout.status,
    paymentStatus: checkout.payment_status,
    callbackUrl: callbackUrl(getEcwidPublicCheckoutOrigin(), `/api/integrations/ecwid/return/${encodeURIComponent(session.id)}`),
  };
}

export async function retrieveEcwidStripeCheckout(sessionId: string) {
  const { session, stripeConnect } = await loadStripeCheckoutRecord(sessionId);
  if (!session.stripeCheckoutSessionId) throw new HttpError(409, "Stripe Checkout Session is unavailable");
  let checkout: Stripe.Checkout.Session;
  try {
    checkout = await getStripeClient().checkout.sessions.retrieve(
      session.stripeCheckoutSessionId,
      {},
      { stripeContext: stripeConnect.stripeAccountId },
    );
  } catch (error) {
    return mapStripeCheckoutError(error);
  }
  assertCheckoutMatchesSession(checkout, session);
  const intentId = await attachCheckoutPaymentIntent(session.paymentTransactionId, checkout);
  return { session, checkout, intentId, stripeAccountId: stripeConnect.stripeAccountId };
}

export async function expireEcwidStripeCheckout(sessionId: string) {
  const current = await retrieveEcwidStripeCheckout(sessionId);
  if (current.checkout.status !== "open") return current;
  let checkout: Stripe.Checkout.Session;
  try {
    checkout = await getStripeClient().checkout.sessions.expire(
      current.checkout.id,
      {},
      { stripeContext: current.stripeAccountId },
    );
  } catch (error) {
    const refreshed = await retrieveEcwidStripeCheckout(sessionId);
    if (refreshed.checkout.status !== "open") return refreshed;
    return mapStripeCheckoutError(error);
  }
  assertCheckoutMatchesSession(checkout, current.session);
  const intentId = await attachCheckoutPaymentIntent(current.session.paymentTransactionId, checkout);
  return { ...current, checkout, intentId };
}

export async function verifyEcwidCheckoutPaymentIntent(
  paymentTransactionId: string,
  stripePaymentIntentId: string,
  stripeAccountId: string,
) {
  const record = await getDatabase().ecwidPaymentSession.findUnique({
    where: { paymentTransactionId },
    select: { id: true, checkoutMode: true, stripeCheckoutSessionId: true },
  });
  if (!record || record.checkoutMode !== "STRIPE_CHECKOUT" || !record.stripeCheckoutSessionId) {
    throw new Error("ecwid_checkout_session_not_found");
  }
  const current = await retrieveEcwidStripeCheckout(record.id);
  if (current.stripeAccountId !== stripeAccountId || current.intentId !== stripePaymentIntentId) {
    throw new Error("ecwid_checkout_payment_intent_mismatch");
  }
}
