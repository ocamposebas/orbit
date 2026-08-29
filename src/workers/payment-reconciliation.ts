import { reconcileSucceededWooPayments } from "@/payments/reconcile";
import { reconcileExpiredEcwidStripeCheckouts, reconcilePendingEcwidPayments } from "@/integrations/ecwid/service";
import { childLogger } from "@/sentinel/logger";

const log = childLogger({ component: "payment-reconciliation-worker" });
let running = false;

async function run() {
  if (running) return;
  running = true;
  try {
    const [woo, ecwid, checkout] = await Promise.all([
      reconcileSucceededWooPayments(),
      reconcilePendingEcwidPayments(),
      reconcileExpiredEcwidStripeCheckouts(),
    ]);
    if (woo.inspected > 0) log.info(woo, "Reconciled successful Stripe payments with WooCommerce");
    if (ecwid.inspected > 0) log.info(ecwid, "Reconciled Ecwid payment status updates");
    if (checkout.inspected > 0) log.info(checkout, "Reconciled expired or delayed Ecwid Stripe Checkout Sessions");
  } catch (error) {
    log.error({ error }, "Payment reconciliation cycle failed");
  } finally {
    running = false;
  }
}

void run();
setInterval(() => void run(), 60_000).unref();
