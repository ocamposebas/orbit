import { randomBytes } from "node:crypto";
import { verifyWooCommerceOrder } from "@/commerce/woocommerce/service";
import { getDatabase } from "@/sentinel/db";
import { HttpError } from "@/sentinel/http";

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
  if (transaction && mutablePreparationStatuses.has(transaction.status)) {
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
    status: transaction.status,
    stripeAccountStatus: merchant.stripeConnect.displayStatus,
    cardPaymentsStatus: merchant.stripeConnect.cardPaymentsStatus ?? "not_reported",
    stripeReadiness: merchant.stripeConnect.cardPaymentsStatus?.toLowerCase() === "active" ? "READY" as const : "STRIPE_NOT_READY" as const,
  };
}
