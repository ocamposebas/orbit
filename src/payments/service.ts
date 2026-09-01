import { randomBytes } from "node:crypto";
import { verifyWooCommerceOrder } from "@/commerce/woocommerce/service";
import { verifyCheckoutConfigToken, verifyCheckoutToken } from "@/payments/checkout-token";
import { getServerEnv } from "@/sentinel/config";
import { getDatabase } from "@/sentinel/db";
import { HttpError } from "@/sentinel/http";
import { childLogger } from "@/sentinel/logger";
import { getStripeClient, getStripeConfiguration, stripeEnvironment } from "@/stripe/client";
import { canonicalOrbitOrigin } from "@/stripe/onboarding-navigation";

const mutablePreparationStatuses = new Set(["CREATED", "REQUIRES_PAYMENT"]);
const paymentLog = childLogger({ component: "stripe-payment-create" });

export class StripePaymentIntentParameterError extends HttpError {
  constructor(
    readonly stripeCode: string,
    readonly stripeParam: string,
    readonly stripeMessage: string,
  ) {
    super(422, "Stripe rejected the PaymentIntent parameters");
  }
}

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
  if (transaction?.stripePaymentIntentId && (
    transaction.stripeAccountId !== values.stripeAccountId ||
    transaction.amountMinor !== values.amountMinor ||
    transaction.currency !== values.currency ||
    transaction.platformFeeBps !== values.platformFeeBps ||
    transaction.platformFeeMinor !== values.platformFeeMinor
  )) {
    throw new HttpError(409, "The WooCommerce order changed after its payment was prepared. Start a fresh checkout session.");
  }
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

export function paymentMethodConfigurationId() {
  const value = getServerEnv().STRIPE_PAYMENT_METHOD_CONFIGURATION_ID;
  if (!value || !/^pmc_[A-Za-z0-9]+$/.test(value)) {
    throw new HttpError(503, "Stripe payment method configuration is not configured");
  }
  return value;
}

export function stripePaymentIntentIdempotencyKey(orbitTransactionId: string, configurationId = "default") {
  return `orbit-payment-intent-${orbitTransactionId}-${configurationId}`;
}

function mapPaymentIntentFailure(error: unknown): never {
  if (error instanceof HttpError) throw error;
  const value = error as { type?: string; code?: string; param?: string; statusCode?: number; message?: string };
  const safeCode = String(value.code ?? "unknown").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "unknown";
  const safeParam = String(value.param ?? "unknown").replace(/[^A-Za-z0-9_.\[\]-]/g, "").slice(0, 120) || "unknown";
  const safeMessage = String(value.message ?? "Stripe request failed")
    .replace(/(?:ctoken|pi|seti|acct|pm|ch|src|tok)_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/(?:sk|pk)_(?:live|test)_[A-Za-z0-9_]+/g, "[redacted]")
    .slice(0, 300);
  paymentLog.error({
    paymentFlow: "client_confirm_v2",
    stripeErrorType: String(value.type ?? "unknown").slice(0, 80),
    stripeErrorCode: safeCode,
    stripeErrorParam: safeParam,
    stripeStatusCode: Number.isInteger(value.statusCode) ? value.statusCode : undefined,
    stripeMessage: safeMessage,
  }, "Stripe PaymentIntent preparation failed");
  if (value.type === "StripeAuthenticationError") throw new HttpError(503, "Stripe rejected the configured server credential");
  if (value.type === "StripePermissionError") throw new HttpError(503, "The Stripe credential cannot create payments for this connected account");
  if (value.type === "StripeRateLimitError" || value.statusCode === 429) throw new HttpError(429, "Stripe rate limited this request. Try again shortly.");
  if (value.type === "StripeInvalidRequestError" || value.statusCode === 400) {
    throw new StripePaymentIntentParameterError(safeCode, safeParam, safeMessage);
  }
  throw new HttpError(502, "Stripe payment creation is temporarily unavailable");
}

async function ensureStripePaymentIntent(merchantId: string, orbitTransactionId: string, expectedSource?: "WOOCOMMERCE" | "ECWID") {
  if (!/^orb_tx_[A-Za-z0-9_-]{16,128}$/.test(orbitTransactionId)) throw new HttpError(400, "Enter a valid ORBIT transaction ID");

  const db = getDatabase();
  const transaction = await db.paymentTransaction.findFirst({
    where: { id: orbitTransactionId, merchantId },
    include: {
      merchant: { select: { stripeConnect: { select: { stripeAccountId: true, stripeEnvironment: true, displayStatus: true, cardPaymentsStatus: true } } } },
      paymentSession: { select: { id: true, installationId: true, platformOrderId: true } },
    },
  });
  if (!transaction) throw new HttpError(404, "ORBIT transaction not found");
  if (expectedSource && transaction.source !== expectedSource) throw new HttpError(404, "ORBIT transaction not found");
  const mayCreate = ["CREATED", "REQUIRES_PAYMENT"].includes(transaction.status);
  const mayRetrieve = Boolean(transaction.stripePaymentIntentId) && ["CREATED", "REQUIRES_PAYMENT", "PROCESSING", "FAILED"].includes(transaction.status);
  if (!mayCreate && !mayRetrieve) throw new HttpError(409, "This ORBIT transaction cannot create a PaymentIntent in its current status");
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
    const configurationId = paymentMethodConfigurationId();
    const createIntent = () => stripe.paymentIntents.create({
          amount: transaction.amountMinor,
          currency: transaction.currency.toLowerCase(),
          application_fee_amount: transaction.platformFeeMinor,
          automatic_payment_methods: { enabled: true },
          payment_method_configuration: configurationId,
          metadata: {
            orbitTransactionId: transaction.id,
            ...(transaction.publicPaymentId ? { orbitPaymentId: transaction.publicPaymentId } : {}),
            wooOrderId: transaction.paymentSession?.platformOrderId ?? transaction.wooOrderId,
            merchantId: transaction.merchantId,
            paymentSource: transaction.source,
            ...(transaction.paymentSession ? {
              installationId: transaction.paymentSession.installationId,
              orbitSessionId: transaction.paymentSession.id,
              transactionReference: transaction.wooOrderId,
            } : {}),
          },
        }, { ...requestOptions, idempotencyKey: stripePaymentIntentIdempotencyKey(transaction.id, configurationId) });

    let paymentIntent = transaction.stripePaymentIntentId
      ? await stripe.paymentIntents.retrieve(transaction.stripePaymentIntentId, {}, requestOptions)
      : await createIntent();

    if (transaction.stripePaymentIntentId && paymentIntent.payment_method_configuration_details?.id !== configurationId) {
      if (!["requires_payment_method", "requires_confirmation"].includes(paymentIntent.status)) {
        throw new HttpError(409, "The existing Stripe payment uses an outdated configuration and can no longer be replaced safely");
      }
      await stripe.paymentIntents.cancel(paymentIntent.id, {}, requestOptions);
      paymentIntent = await createIntent();
      paymentLog.warn({ orbitTransactionId: transaction.id }, "Replaced a legacy PaymentIntent that used an outdated payment method configuration");
    }

    if (!paymentIntent.id.startsWith("pi_")) throw new HttpError(502, "Stripe returned an invalid PaymentIntent");
    if (paymentIntent.amount !== transaction.amountMinor || paymentIntent.currency.toUpperCase() !== transaction.currency || paymentIntent.application_fee_amount !== transaction.platformFeeMinor) {
      throw new HttpError(409, "The Stripe PaymentIntent does not match the stored ORBIT transaction");
    }

    if (transaction.stripePaymentIntentId !== paymentIntent.id) {
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
      clientSecret: paymentIntent.client_secret,
    };
  } catch (error) {
    return mapPaymentIntentFailure(error);
  }
}

export async function createStripePaymentIntent(merchantId: string, orbitTransactionId: string) {
  const result = await ensureStripePaymentIntent(merchantId, orbitTransactionId);
  return {
    orbitTransactionId: result.orbitTransactionId,
    wooOrderId: result.wooOrderId,
    stripePaymentIntentId: result.stripePaymentIntentId,
    amountMinor: result.amountMinor,
    currency: result.currency,
    platformFeeBps: result.platformFeeBps,
    platformFeeMinor: result.platformFeeMinor,
    connectedAccount: result.connectedAccount,
    stripeStatus: result.stripeStatus,
    transactionStatus: result.transactionStatus,
  };
}

function paymentStatusFromStripe(status: string) {
  if (status === "succeeded") return "SUCCEEDED" as const;
  if (status === "processing") return "PROCESSING" as const;
  if (status === "canceled") return "CANCELED" as const;
  if (status === "requires_payment_method") return "REQUIRES_PAYMENT" as const;
  if (["requires_confirmation", "requires_action", "requires_capture"].includes(status)) return "PROCESSING" as const;
  return "FAILED" as const;
}

export async function refreshPaymentTransactionFromStripe(
  merchantId: string,
  orbitTransactionId: string,
  expectedSource: "WOOCOMMERCE" | "ECWID",
) {
  const db = getDatabase();
  const transaction = await db.paymentTransaction.findFirst({ where: { id: orbitTransactionId, merchantId, source: expectedSource } });
  if (!transaction?.stripePaymentIntentId) throw new HttpError(409, "Payment processor transaction is unavailable");
  const config = getStripeConfiguration();
  if (!config.configured) throw new HttpError(503, "Stripe Connect is not configured");
  let intent;
  try {
    intent = await getStripeClient().paymentIntents.retrieve(
      transaction.stripePaymentIntentId,
      {},
      { stripeContext: transaction.stripeAccountId },
    );
  } catch (error) {
    return mapPaymentIntentFailure(error);
  }
  if (
    intent.id !== transaction.stripePaymentIntentId || intent.amount !== transaction.amountMinor ||
    intent.currency.toUpperCase() !== transaction.currency || intent.application_fee_amount !== transaction.platformFeeMinor ||
    intent.metadata.orbitTransactionId !== transaction.id || intent.metadata.merchantId !== transaction.merchantId
  ) throw new HttpError(409, "The Stripe payment does not match the stored ORBIT transaction");
  const observedStatus = paymentStatusFromStripe(intent.status);
  const status = transaction.status === "SUCCEEDED" ? "SUCCEEDED" as const : observedStatus;
  if (transaction.status !== status) {
    await db.paymentTransaction.updateMany({
      where: { id: transaction.id, ...(status === "SUCCEEDED" ? {} : { status: { not: "SUCCEEDED" } }) },
      data: { status },
    });
  }
  return { status, stripeStatus: intent.status, stripePaymentIntentId: intent.id };
}

function customerPublishableKey() {
  const env = getServerEnv();
  if (env.STRIPE_MODE === "live") canonicalOrbitOrigin(env.APP_URL);
  const key = env.STRIPE_PUBLISHABLE_KEY;
  if (!key) throw new HttpError(503, "Customer Stripe checkout is not configured");
  const keyMode = key.startsWith("pk_live_") ? "live" : key.startsWith("pk_test_") ? "test" : undefined;
  if (!keyMode || keyMode !== env.STRIPE_MODE) throw new HttpError(503, "Stripe publishable key environment mismatch");
  return key;
}

export async function createCustomerCheckout(checkoutToken: string) {
  const authorizedOrder = await verifyCheckoutToken(checkoutToken);
  const transaction = await preparePaymentTransaction(authorizedOrder.merchantId, authorizedOrder.wooOrderId);
  if (transaction.amountMinor !== authorizedOrder.amountMinor || transaction.currency !== authorizedOrder.currency) {
    throw new HttpError(409, "The signed checkout quote no longer matches the WooCommerce order. Refresh checkout and try again.");
  }
  if (transaction.status !== "REQUIRES_PAYMENT" && !transaction.stripePaymentIntentId) {
    throw new HttpError(409, "WooCommerce reports that this order does not require payment");
  }
  if (transaction.stripeReadiness !== "READY") throw new HttpError(409, "STRIPE_NOT_READY");
  if (!getServerEnv().STRIPE_PAYMENTS_WEBHOOK_SECRET) {
    throw new HttpError(503, "Stripe payment completion webhook is not configured");
  }

  const paymentIntent = await ensureStripePaymentIntent(authorizedOrder.merchantId, transaction.id);
  if (!paymentIntent.clientSecret) throw new HttpError(502, "Stripe did not return a client secret");

  return {
    orbitTransactionId: transaction.id,
    clientSecret: paymentIntent.clientSecret,
    connectedAccountId: paymentIntent.connectedAccount,
    publishableKey: customerPublishableKey(),
    paymentMethodConfigurationId: paymentMethodConfigurationId(),
    stripeStatus: paymentIntent.stripeStatus,
  };
}

export async function createPaymentCheckoutForTransaction(
  merchantId: string,
  orbitTransactionId: string,
  expectedSource: "WOOCOMMERCE" | "ECWID",
) {
  if (!getServerEnv().STRIPE_PAYMENTS_WEBHOOK_SECRET) throw new HttpError(503, "Stripe payment completion webhook is not configured");
  const paymentIntent = await ensureStripePaymentIntent(merchantId, orbitTransactionId, expectedSource);
  if (!paymentIntent.clientSecret) throw new HttpError(502, "Stripe did not return a client secret");
  return {
    orbitTransactionId: paymentIntent.orbitTransactionId,
    clientSecret: paymentIntent.clientSecret,
    connectedAccountId: paymentIntent.connectedAccount,
    publishableKey: customerPublishableKey(),
    paymentMethodConfigurationId: paymentMethodConfigurationId(),
    stripeStatus: paymentIntent.stripeStatus,
  };
}

export async function getCustomerCheckoutConfiguration(configToken: string) {
  const authorized = await verifyCheckoutConfigToken(configToken);
  const merchant = await getDatabase().merchant.findUnique({
    where: { id: authorized.merchantId },
    select: { stripeConnect: { select: { stripeAccountId: true, stripeEnvironment: true, cardPaymentsStatus: true } } },
  });
  const stripeConnect = merchant?.stripeConnect;
  if (!stripeConnect || stripeConnect.cardPaymentsStatus?.toLowerCase() !== "active") throw new HttpError(409, "STRIPE_NOT_READY");
  const config = getStripeConfiguration();
  if (!config.configured) throw new HttpError(503, "Stripe Connect is not configured");
  if (stripeConnect.stripeEnvironment !== stripeEnvironment(config.mode)) throw new HttpError(409, "Stripe environment mismatch");

  return {
    connectedAccountId: stripeConnect.stripeAccountId,
    publishableKey: customerPublishableKey(),
    paymentMethodConfigurationId: paymentMethodConfigurationId(),
  };
}
