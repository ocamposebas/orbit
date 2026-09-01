import { randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { getDatabase } from "@/sentinel/db";
import { childLogger } from "@/sentinel/logger";
import { safeFetchText } from "@/sentinel/security/ssrf";
import { createWooCommerceAuthHeaders } from "./auth";
import { decryptInstallationSecret } from "./installation-crypto";

const log = childLogger({ component: "woocommerce-payment-events" });
const MAX_DELIVERY_ATTEMPTS = 10;

function eventId() {
  return `evt_${randomBytes(18).toString("base64url")}`;
}

function retryAt(attempt: number) {
  return new Date(Date.now() + Math.min(60 * 60_000, 15_000 * 2 ** Math.min(attempt, 8)));
}

function safeErrorCode(error: unknown) {
  const value = error as { code?: string; name?: string };
  return String(value.code ?? value.name ?? "delivery_failed").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120);
}

export async function recordWooCommercePaymentSucceeded(input: {
  transactionId: string;
  stripePaymentIntentId: string;
}) {
  const db = getDatabase();
  const session = await db.paymentSession.findUnique({ where: { paymentTransactionId: input.transactionId }, include: {
    merchant: { select: { publicId: true } },
    paymentTransaction: { select: { publicPaymentId: true } },
  } });
  if (!session || session.platform !== "WOOCOMMERCE" || !session.merchant.publicId || !session.paymentTransaction.publicPaymentId) return null;
  const occurredAt = new Date();
  const id = eventId();
  const payload = {
    id,
    type: "payment.succeeded",
    merchant_id: session.merchant.publicId,
    installation_id: session.installationId,
    order_id: Number(session.platformOrderId),
    orbit_session_id: session.id,
    orbit_payment_id: session.paymentTransaction.publicPaymentId,
    amount_minor: session.amountMinor,
    currency: session.currency,
    occurred_at: occurredAt.toISOString(),
  } satisfies Record<string, Prisma.JsonValue>;
  try {
    return await db.$transaction(async (tx) => {
      await tx.paymentSession.update({ where: { id: session.id }, data: { status: "SUCCEEDED", completedAt: occurredAt } });
      return tx.paymentEventDelivery.create({ data: {
        id,
        merchantId: session.merchantId,
        installationId: session.installationId,
        paymentSessionId: session.id,
        type: "payment.succeeded",
        payload,
        nextAttemptAt: occurredAt,
      } });
    });
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) throw error;
    return db.paymentEventDelivery.findUnique({ where: { paymentSessionId_type: { paymentSessionId: session.id, type: "payment.succeeded" } } });
  }
}

export async function deliverWooCommercePaymentEvent(deliveryId: string) {
  const db = getDatabase();
  const delivery = await db.paymentEventDelivery.findUnique({ where: { id: deliveryId }, include: {
    installation: true,
    merchant: { select: { publicId: true } },
    paymentSession: { select: { paymentTransactionId: true } },
  } });
  if (!delivery || delivery.status === "DELIVERED") return { delivered: true, duplicate: true };
  if (delivery.status === "FAILED") return { delivered: false, terminal: true };
  if (!delivery.installation.enabled || delivery.installation.revokedAt || !delivery.merchant.publicId) {
    await db.paymentEventDelivery.update({ where: { id: delivery.id }, data: {
      status: "FAILED", attempts: { increment: 1 }, lastAttemptAt: new Date(), lastErrorCode: "installation_revoked", nextAttemptAt: null,
    } });
    return { delivered: false, terminal: true };
  }

  const path = "/wp-json/orbit-payments/v1/events";
  const rawBody = JSON.stringify(delivery.payload);
  const secret = decryptInstallationSecret(delivery.installation.encryptedSigningSecret, delivery.installation.id);
  const headers = createWooCommerceAuthHeaders({
    merchantId: delivery.merchant.publicId,
    installationId: delivery.installationId,
    method: "POST",
    path,
    rawBody,
    secret,
  });
  const attempt = delivery.attempts + 1;
  const attemptedAt = new Date();
  try {
    const response = await safeFetchText(`${delivery.installation.origin}${path}`, {
      method: "POST",
      body: rawBody,
      timeoutMs: 8_000,
      maxBytes: 32_768,
      maxRedirects: 0,
      accept: "application/json",
      headers: { ...headers, "Content-Type": "application/json" },
    });
    if (response.url.origin !== delivery.installation.origin) throw new Error("event_origin_changed");
    if (response.status >= 200 && response.status < 300) {
      await db.$transaction([
        db.paymentEventDelivery.update({ where: { id: delivery.id }, data: {
          status: "DELIVERED", attempts: attempt, lastAttemptAt: attemptedAt, lastHttpStatus: response.status,
          lastErrorCode: null, nextAttemptAt: null, deliveredAt: new Date(),
        } }),
        db.paymentTransaction.updateMany({ where: { id: delivery.paymentSession.paymentTransactionId, status: "SUCCEEDED", wooCompletedAt: null }, data: { wooCompletedAt: new Date() } }),
        db.wooCommerceInstallation.update({ where: { id: delivery.installationId }, data: { lastPaymentAt: new Date() } }),
      ]);
      return { delivered: true };
    }
    const transient = [408, 425, 429].includes(response.status) || response.status >= 500;
    const terminal = !transient || attempt >= MAX_DELIVERY_ATTEMPTS;
    await db.paymentEventDelivery.update({ where: { id: delivery.id }, data: {
      status: terminal ? "FAILED" : "PENDING",
      attempts: attempt,
      lastAttemptAt: attemptedAt,
      lastHttpStatus: response.status,
      lastErrorCode: `http_${response.status}`,
      nextAttemptAt: terminal ? null : retryAt(attempt),
    } });
    return { delivered: false, terminal };
  } catch (error) {
    const terminal = attempt >= MAX_DELIVERY_ATTEMPTS;
    await db.paymentEventDelivery.update({ where: { id: delivery.id }, data: {
      status: terminal ? "FAILED" : "PENDING",
      attempts: attempt,
      lastAttemptAt: attemptedAt,
      lastErrorCode: safeErrorCode(error),
      nextAttemptAt: terminal ? null : retryAt(attempt),
    } });
    log.warn({ eventId: delivery.id, sessionId: delivery.paymentSessionId, attempt, errorCode: safeErrorCode(error) }, "WooCommerce payment event delivery deferred");
    return { delivered: false, terminal };
  }
}

export async function reconcileWooCommercePaymentEvents(limit = 50) {
  const events = await getDatabase().paymentEventDelivery.findMany({ where: {
    status: "PENDING",
    OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
  }, orderBy: { createdAt: "asc" }, take: Math.min(Math.max(limit, 1), 100), select: { id: true } });
  let delivered = 0;
  for (const event of events) if ((await deliverWooCommercePaymentEvent(event.id)).delivered) delivered += 1;
  await getDatabase().wooCommerceRequestNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return { inspected: events.length, delivered, pending: events.length - delivered };
}
