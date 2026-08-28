import { completeWooCommerceOrderPayment } from "@/commerce/woocommerce/service";
import { getDatabase } from "@/sentinel/db";
import { childLogger } from "@/sentinel/logger";

const log = childLogger({ component: "payment-reconciliation" });

export async function reconcileSucceededWooPayments(limit = 50) {
  const db = getDatabase();
  const transactions = await db.paymentTransaction.findMany({
    where: {
      status: "SUCCEEDED",
      wooCompletedAt: null,
      stripePaymentIntentId: { not: null },
    },
    orderBy: { updatedAt: "asc" },
    take: Math.min(Math.max(limit, 1), 100),
  });

  let completed = 0;
  let failed = 0;
  for (const transaction of transactions) {
    try {
      const orderId = Number(transaction.wooOrderId);
      if (!Number.isSafeInteger(orderId) || orderId <= 0 || !transaction.stripePaymentIntentId) {
        throw new Error("invalid_reconciliation_transaction");
      }
      await completeWooCommerceOrderPayment(
        transaction.merchantId,
        orderId,
        transaction.id,
        transaction.stripePaymentIntentId,
      );
      await db.paymentTransaction.updateMany({
        where: { id: transaction.id, wooCompletedAt: null, status: "SUCCEEDED" },
        data: { wooCompletedAt: new Date() },
      });
      completed += 1;
    } catch (error) {
      failed += 1;
      log.error({ transactionId: transaction.id, error }, "Failed to reconcile a successful Stripe payment with WooCommerce");
    }
  }

  return { inspected: transactions.length, completed, failed };
}
