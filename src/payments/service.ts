import { randomBytes } from "node:crypto";
import { verifyWooCommerceOrder } from "@/commerce/woocommerce/service";
import { getDatabase } from "@/sentinel/db";
import { HttpError } from "@/sentinel/http";
import { getStripeClient, getStripeConfiguration, stripeEnvironment } from "@/stripe/client";

const mutablePreparationStatuses = new Set(["CREATED", "REQUIRES_PAYMENT"]);

function transactionId() {
  return `orb_tx_${randomBytes(18).toString("base64url")}`;
}

export function calculatePlatformFeeMinor(amountMinor: number, platformFeeBps: number) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new HttpError(422, "WooCommerce returned an invalid order total");
  if (!Number.isInteger(platformFeeBps) || platformFeeBps < 0 || platformFeeBps > 10_000) throw new HttpError(422, "Configure a valid merchant platform fee before preparing a transaction");
  return Number((BigInt(amountMinor) * BigInt(platformFeeBps) + BigInt(5_000)) / BigInt(10_000));
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function preparePaymentTransaction(merchantId: string, wooOrderId: number) {
  const order = await verifyWooCommerceOrder(merchantId, wooOrderId);
  const db = getDatabase();
  const merchant = await db.merchant.findUnique({
    where: { id: merchantId },
    select: {
      id: true,
      platformFeeBps: true,
      stripeConnect: { select: { stripeAccountId: true, displayStatus: true, cardPaymentsStatus: true } },
    },
  });
  if (!merchant) throw new HttpError(404, "Merchant not found");
  if (merchant.platformFeeBps === null) throw new HttpError(409, "Configure the merchant platform fee before preparing a transaction");
  if (!merchant.stripeConnect) throw new HttpError(409, "Connect this merchant to Stripe before preparing a transaction");

  const platformFeeMinor = calculatePlatformFeeMinor(order.totalMinor, merchant.platformFeeBps);
  const wooOrderKey = String(order.orderId);
  const status = order.paymentRequired ? "REQUIRES_PAYMENT" as const : "CREATED" as const;
  const values = {
    stripeAccountId: merchant.stripeConnect.stripeAccountId,
    amountMinor: order.totalMinor,
    currency: order.currency,
    platformFeeBps: merchant.platformFeeBps,
    platformFeeMinor,
    status,
  };

  let transaction = await db.paymentTransaction.findUnique({ where: { merchantId_wooOrderId: { merchantId, wooOrderId: wooOrderKey } } });
  if (transaction && !transaction.stripePaymentIntentId && mutablePreparationStatuses.has(transaction.status)) {
    transaction = await db.paymentTransaction.update({ where: { id: transaction.id }, data: values });
  } else if (!transaction) {
    try {
      transaction = await db.paymentTransaction.create({ data: { id: transactionId(), merchantId, wooOrderId: wooOrderKey, ...values } });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      transaction = await db.paymentTransaction.findUnique({ where: { merchantId_wooOrderId: { merchantId, wooOrderId: wooOrderKey } } });
      if (!transaction) throw error;
    }
  }

  return {
    id: transaction.id,
    wooOrderId: transaction.wooOrderId,
    amountMinor: transaction.amountMinor,
    currency: transaction.currency,
    platformFeeBps: transaction.platformFeeBps,
    platformFeeMinor: transaction.platformFeeMinor,
    stripePaymentIntentId: transaction.stripePaymentIntentId,
    status: transaction.status,
    stripeAccountStatus: merchant.stripeConnect.displayStatus,
    cardPaymentsStatus: merchant.stripeConnect.cardPaymentsStatus ?? "not_reported",
    stripeReadiness: merchant.stripeConnect.cardPaymentsStatus?.toLowerCase() === "active" ? "READY" as const : "STRIPE_NOT_READY" as const,
  };
}

export function stripePaymentIntentIdempotencyKey(orbitTransactionId: string) {
  return `orbit-payment-intent-${orbitTransactionId}`;
}

function mapPaymentIntentFailure(error: unknown): never {
  if (error instanceof HttpError) throw error;
  const value = error as { type?: string; statusCode?: number };
  if (value.type === "StripeAuthenticationError") throw new HttpError(503, "Stripe rejected the configured server credential");
  if (value.type === "StripePermissionError") throw new HttpError(503, "The Stripe credential cannot create payments for this connected account");
  if (value.type === "StripeRateLimitError" || value.statusCode === 429) throw new HttpError(429, "Stripe rate limited this request. Try again shortly.");
  if (value.type === "StripeInvalidRequestError" || value.statusCode === 400) throw new HttpError(422, "Stripe rejected the PaymentIntent parameters");
  throw new HttpError(502, "Stripe payment creation is temporarily unavailable");
}

export async function createStripePaymentIntent(merchantId: string, orbitTransactionId: string) {
  if (!/^orb_tx_[A-Za-z0-9_-]{16,128}$/.test(orbitTransactionId)) throw new HttpError(400, "Enter a valid ORBIT transaction ID");

  const db = getDatabase();
  const transaction = await db.paymentTransaction.findFirst({
    where: { id: orbitTransactionId, merchantId },
    include: { merchant: { select: { stripeConnect: { select: { stripeAccountId: true, stripeEnvironment: true, displayStatus: true, cardPaymentsStatus: true } } } } },
  });
  if (!transaction) throw new HttpError(404, "ORBIT transaction not found");
  if (!["CREATED", "REQUIRES_PAYMENT"].includes(transaction.status)) throw new HttpError(409, "This ORBIT transaction cannot create a PaymentIntent in its current status");
  const stripeConnect = transaction.merchant.stripeConnect;
  if (!stripeConnect || stripeConnect.stripeAccountId !== transaction.stripeAccountId) throw new HttpError(409, "The transaction's Stripe connected account is no longer available");
  if (stripeConnect.cardPaymentsStatus?.toLowerCase() !== "active") throw new HttpError(409, "STRIPE_NOT_READY");
  if (transaction.platformFeeMinor <= 0 || transaction.platformFeeMinor >= transaction.amountMinor) throw new HttpError(422, "The stored ORBIT application fee must be positive and lower than the transaction total");

  const config = getStripeConfiguration();
  if (!config.configured) throw new HttpError(503, "Stripe Connect is not configured");
  if (stripeConnect.stripeEnvironment !== stripeEnvironment(config.mode)) throw new HttpError(409, "Stripe environment mismatch");

  const stripe = getStripeClient();
  try {
    const requestOptions = { stripeContext: transaction.stripeAccountId };
    const paymentIntent = transaction.stripePaymentIntentId
      ? await stripe.paymentIntents.retrieve(transaction.stripePaymentIntentId, {}, requestOptions)
      : await stripe.paymentIntents.create({
          amount: transaction.amountMinor,
          currency: transaction.currency.toLowerCase(),
          application_fee_amount: transaction.platformFeeMinor,
          automatic_payment_methods: { enabled: true },
          confirm: false,
          metadata: {
            orbitTransactionId: transaction.id,
            wooOrderId: transaction.wooOrderId,
            merchantId: transaction.merchantId,
          },
        }, { ...requestOptions, idempotencyKey: stripePaymentIntentIdempotencyKey(transaction.id) });

    if (!paymentIntent.id.startsWith("pi_")) throw new HttpError(502, "Stripe returned an invalid PaymentIntent");
    if (paymentIntent.amount !== transaction.amountMinor || paymentIntent.currency.toUpperCase() !== transaction.currency || paymentIntent.application_fee_amount !== transaction.platformFeeMinor) {
      throw new HttpError(409, "The Stripe PaymentIntent does not match the stored ORBIT transaction");
    }

    if (!transaction.stripePaymentIntentId) {
      await db.paymentTransaction.update({ where: { id: transaction.id }, data: { stripePaymentIntentId: paymentIntent.id } });
    }

    return {
      orbitTransactionId: transaction.id,
      wooOrderId: transaction.wooOrderId,
      stripePaymentIntentId: paymentIntent.id,
      amountMinor: transaction.amountMinor,
      currency: transaction.currency,
      platformFeeBps: transaction.platformFeeBps,
      platformFeeMinor: transaction.platformFeeMinor,
      connectedAccount: transaction.stripeAccountId,
      stripeStatus: paymentIntent.status,
      transactionStatus: transaction.status,
    };
  } catch (error) {
    return mapPaymentIntentFailure(error);
  }
}
