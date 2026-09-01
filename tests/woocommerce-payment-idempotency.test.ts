import { describe, expect, it } from "vitest";
import { stripePaymentIntentIdempotencyKey } from "@/payments/service";

describe("WooCommerce PaymentIntent idempotency", () => {
  it("uses the same Stripe key when a hosted session retries the same transaction", () => {
    const transactionId = "orb_tx_transaction123456789";
    const configurationId = "pmc_configuration123456";
    expect(stripePaymentIntentIdempotencyKey(transactionId, configurationId)).toBe(`orbit-payment-intent-${transactionId}-${configurationId}`);
    expect(stripePaymentIntentIdempotencyKey(transactionId, configurationId)).toBe(stripePaymentIntentIdempotencyKey(transactionId, configurationId));
  });
});
