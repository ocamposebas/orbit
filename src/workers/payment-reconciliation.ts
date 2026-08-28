import { reconcileSucceededWooPayments } from "@/payments/reconcile";
import { childLogger } from "@/sentinel/logger";

const log = childLogger({ component: "payment-reconciliation-worker" });
let running = false;

async function run() {
  if (running) return;
  running = true;
  try {
    const result = await reconcileSucceededWooPayments();
    if (result.inspected > 0) log.info(result, "Reconciled successful Stripe payments with WooCommerce");
  } catch (error) {
    log.error({ error }, "Payment reconciliation cycle failed");
  } finally {
    running = false;
  }
}

void run();
setInterval(() => void run(), 60_000).unref();
