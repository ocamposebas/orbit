import type Stripe from "stripe";
import { completeWooCommerceOrderPayment } from "@/commerce/woocommerce/service";
import { deliverWooCommercePaymentEvent, recordWooCommercePaymentSucceeded } from "@/commerce/woocommerce/events";
import { syncEcwidForTransaction } from "@/integrations/ecwid/service";
import { verifyEcwidCheckoutPaymentIntent } from "@/integrations/ecwid/stripe-checkout";
import { getDatabase } from "@/sentinel/db";
import { childLogger } from "@/sentinel/logger";
import { expectedLivemode, getStripeConfiguration } from "@/stripe/client";

const log = childLogger({ component: "stripe-payment-events" });
const supportedTypes = new Set([
  "payment_intent.succeeded",
  "payment_intent.processing",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
]);

function connectedAccountId(event: Stripe.Event) {
  if (event.account?.startsWith("acct_")) return event.account;
  return event.context?.match(/acct_[A-Za-z0-9]+/)?.[0];
}

function errorCode(error: unknown) {
  const value = error as { code?: string; name?: string; message?: string };
  const candidate = value.code ?? value.message ?? value.name ?? "payment_event_failed";
  return candidate.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120);
}

async function finishEvent(id: string, status: "PROCESSED" | "IGNORED", code?: string) {
  await getDatabase().stripePaymentEvent.update({
    where: { id },
    data: { status, errorCode: code ?? null, processedAt: new Date() },
  });
}

async function beginEvent(event: Stripe.Event, accountId: string | undefined, intentId: string | undefined) {
  const db = getDatabase();
  try {
    return await db.stripePaymentEvent.create({
      data: {
        stripeEventId: event.id,
        stripePaymentIntentId: intentId,
        stripeAccountId: accountId,
        type: event.type,
        livemode: event.livemode,
      },
    });
  } catch {
    const existing = await db.stripePaymentEvent.findUnique({ where: { stripeEventId: event.id } });
    if (!existing) throw new Error("Unable to record Stripe payment event");
    if (existing.status === "PROCESSED" || existing.status === "IGNORED") return existing;
    if (existing.status === "PROCESSING" && existing.updatedAt.getTime() > Date.now() - 5 * 60_000) {
      throw new Error("Stripe payment event is already processing");
    }
    return db.stripePaymentEvent.update({
      where: { id: existing.id },
      data: { status: "PROCESSING", errorCode: null, processedAt: null },
    });
  }
}

function assertIntentMatchesTransaction(
  intent: Stripe.PaymentIntent,
  accountId: string,
  transaction: {
    id: string;
    merchantId: string;
    wooOrderId: string;
    stripeAccountId: string;
    stripePaymentIntentId: string | null;
    amountMinor: number;
    currency: string;
    platformFeeMinor: number;
  },
  session?: { id: string; installationId: string; platformOrderId: string } | null,
) {
  if (transaction.stripePaymentIntentId !== intent.id) throw new Error("payment_intent_id_mismatch");
  if (transaction.stripeAccountId !== accountId) throw new Error("connected_account_mismatch");
  if (intent.amount !== transaction.amountMinor) throw new Error("payment_amount_mismatch");
  if (intent.currency.toUpperCase() !== transaction.currency) throw new Error("payment_currency_mismatch");
  if (intent.application_fee_amount !== transaction.platformFeeMinor) throw new Error("application_fee_mismatch");
  if (intent.metadata.orbitTransactionId !== transaction.id) throw new Error("transaction_metadata_mismatch");
  if (intent.metadata.merchantId !== transaction.merchantId) throw new Error("merchant_metadata_mismatch");
  if (intent.metadata.wooOrderId !== (session?.platformOrderId ?? transaction.wooOrderId)) throw new Error("order_metadata_mismatch");
  if (session && (
    intent.metadata.orbitSessionId !== session.id ||
    intent.metadata.installationId !== session.installationId ||
    intent.metadata.transactionReference !== transaction.wooOrderId
  )) throw new Error("payment_session_metadata_mismatch");
}

async function updateNonSucceededStatus(transactionId: string, eventType: string) {
  const db = getDatabase();
  if (eventType === "payment_intent.processing") {
    await db.paymentTransaction.updateMany({
      where: { id: transactionId, status: { notIn: ["SUCCEEDED", "CANCELED"] } },
      data: { status: "PROCESSING" },
    });
  } else if (eventType === "payment_intent.payment_failed") {
    await db.paymentTransaction.updateMany({
      where: { id: transactionId, status: { notIn: ["SUCCEEDED", "CANCELED"] } },
      data: { status: "FAILED" },
    });
  } else if (eventType === "payment_intent.canceled") {
    await db.paymentTransaction.updateMany({
      where: { id: transactionId, status: { not: "SUCCEEDED" } },
      data: { status: "CANCELED" },
    });
  }
}

export async function handleStripePaymentEvent(event: Stripe.Event) {
  const object = event.data.object as { object?: string; id?: string };
  const accountId = connectedAccountId(event);
  const eventRecord = await beginEvent(event, accountId, object.object === "payment_intent" ? object.id : undefined);
  if (eventRecord.status === "PROCESSED" || eventRecord.status === "IGNORED") return { duplicate: true };

  try {
    if (event.livemode !== expectedLivemode(getStripeConfiguration().mode)) {
      await finishEvent(eventRecord.id, "IGNORED", "environment_mismatch");
      return { ignored: true };
    }
    if (!supportedTypes.has(event.type)) {
      await finishEvent(eventRecord.id, "IGNORED", "event_type_not_monitored");
      return { ignored: true };
    }
    if (!accountId?.startsWith("acct_")) {
      await finishEvent(eventRecord.id, "IGNORED", "missing_connected_account");
      return { ignored: true };
    }
    if (object.object !== "payment_intent") throw new Error("invalid_payment_intent_object");

    const intent = event.data.object as Stripe.PaymentIntent;
    const db = getDatabase();
    let transaction = await db.paymentTransaction.findUnique({
      where: { stripePaymentIntentId: intent.id },
    });
    if (!transaction && intent.metadata.paymentSource === "ECWID" && /^orb_tx_[A-Za-z0-9_-]{16,128}$/.test(intent.metadata.orbitTransactionId ?? "")) {
      const candidate = await db.paymentTransaction.findUnique({ where: { id: intent.metadata.orbitTransactionId } });
      if (candidate?.source === "ECWID" && candidate.stripePaymentIntentId === null) {
        await verifyEcwidCheckoutPaymentIntent(candidate.id, intent.id, accountId);
        await db.paymentTransaction.updateMany({
          where: { id: candidate.id, source: "ECWID", stripePaymentIntentId: null },
          data: { stripePaymentIntentId: intent.id },
        });
        transaction = await db.paymentTransaction.findUnique({ where: { id: candidate.id } });
      }
    }
    if (!transaction) {
      await finishEvent(eventRecord.id, "IGNORED", "unknown_payment_intent");
      return { ignored: true };
    }

    const hostedWooSession = transaction.source === "WOOCOMMERCE"
      ? await db.paymentSession.findUnique({ where: { paymentTransactionId: transaction.id }, select: { id: true, installationId: true, platformOrderId: true } })
      : null;
    assertIntentMatchesTransaction(intent, accountId, transaction, hostedWooSession);
    await db.stripePaymentEvent.update({
      where: { id: eventRecord.id },
      data: { transactionId: transaction.id, stripeAccountId: accountId, stripePaymentIntentId: intent.id },
    });

    if (event.type === "payment_intent.succeeded") {
      if (intent.status !== "succeeded") throw new Error("unexpected_payment_intent_status");
      await db.paymentTransaction.update({ where: { id: transaction.id }, data: { status: "SUCCEEDED" } });
      if (transaction.source === "ECWID") {
        await syncEcwidForTransaction(transaction.id, "SUCCEEDED");
      } else if (hostedWooSession) {
        const delivery = await recordWooCommercePaymentSucceeded({ transactionId: transaction.id, stripePaymentIntentId: intent.id });
        if (delivery) await deliverWooCommercePaymentEvent(delivery.id);
      } else if (!transaction.wooCompletedAt) {
        const wooOrderId = Number(transaction.wooOrderId);
        if (!Number.isSafeInteger(wooOrderId) || wooOrderId <= 0) throw new Error("invalid_woo_order_id");
        await completeWooCommerceOrderPayment(transaction.merchantId, wooOrderId, transaction.id, intent.id);
        await db.paymentTransaction.updateMany({
          where: { id: transaction.id, wooCompletedAt: null },
          data: { wooCompletedAt: new Date() },
        });
      }
    } else {
      await updateNonSucceededStatus(transaction.id, event.type);
      if (hostedWooSession) {
        const sessionStatus = event.type === "payment_intent.processing" ? "PROCESSING" : event.type === "payment_intent.canceled" ? "CANCELED" : "FAILED";
        await db.paymentSession.updateMany({ where: { id: hostedWooSession.id, status: { not: "SUCCEEDED" } }, data: { status: sessionStatus } });
      }
      if (transaction.source === "ECWID" && event.type === "payment_intent.canceled") {
        await syncEcwidForTransaction(transaction.id, "CANCELED");
      }
    }

    await finishEvent(eventRecord.id, "PROCESSED");
    log.info({ stripeEventId: event.id, type: event.type, stripeAccountId: accountId, transactionId: transaction.id }, "Processed Stripe payment event");
    return { processed: true };
  } catch (error) {
    const code = errorCode(error);
    await getDatabase().stripePaymentEvent.update({
      where: { id: eventRecord.id },
      data: { status: "FAILED", errorCode: code, processedAt: new Date() },
    });
    log.error({ stripeEventId: event.id, type: event.type, stripeAccountId: accountId, errorCode: code }, "Stripe payment event processing failed");
    throw error;
  }
}
