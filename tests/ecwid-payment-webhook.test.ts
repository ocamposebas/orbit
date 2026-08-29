import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eventCreate: vi.fn(),
  eventFind: vi.fn(),
  eventUpdate: vi.fn(),
  transactionFind: vi.fn(),
  transactionUpdate: vi.fn(),
  transactionUpdateMany: vi.fn(),
  verifyCheckoutIntent: vi.fn(),
  syncEcwid: vi.fn(),
}));

vi.mock("@/sentinel/db", () => ({ getDatabase: () => ({
  stripePaymentEvent: { create: mocks.eventCreate, findUnique: mocks.eventFind, update: mocks.eventUpdate },
  paymentTransaction: { findUnique: mocks.transactionFind, update: mocks.transactionUpdate, updateMany: mocks.transactionUpdateMany },
}) }));
vi.mock("@/stripe/client", () => ({ expectedLivemode: () => false, getStripeConfiguration: () => ({ mode: "test" }) }));
vi.mock("@/integrations/ecwid/stripe-checkout", () => ({ verifyEcwidCheckoutPaymentIntent: mocks.verifyCheckoutIntent }));
vi.mock("@/integrations/ecwid/service", () => ({ syncEcwidForTransaction: mocks.syncEcwid }));
vi.mock("@/commerce/woocommerce/service", () => ({ completeWooCommerceOrderPayment: vi.fn() }));

const transaction = {
  id: "orb_tx_transaction123456789",
  merchantId: "merchant_core",
  wooOrderId: "ecwid:10101010:hash",
  stripeAccountId: "acct_core",
  stripePaymentIntentId: null,
  amountMinor: 22_800,
  currency: "USD",
  platformFeeMinor: 684,
  source: "ECWID",
  wooCompletedAt: null,
};

describe("Ecwid PaymentIntent webhook correlation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eventCreate.mockResolvedValue({ id: "payment_event", status: "PROCESSING" });
    mocks.eventUpdate.mockResolvedValue({});
    mocks.transactionUpdate.mockResolvedValue({});
    mocks.transactionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.verifyCheckoutIntent.mockResolvedValue(undefined);
    mocks.syncEcwid.mockResolvedValue({ synced: true });
    mocks.transactionFind
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(transaction)
      .mockResolvedValueOnce({ ...transaction, stripePaymentIntentId: "pi_checkout_9001" });
  });

  it("attaches a Checkout-created PaymentIntent only after verifying the stored Checkout Session", async () => {
    const { handleStripePaymentEvent } = await import("@/payments/webhook");
    await expect(handleStripePaymentEvent({
      id: "evt_checkout_paid",
      type: "payment_intent.succeeded",
      account: "acct_core",
      livemode: false,
      data: { object: {
        id: "pi_checkout_9001",
        object: "payment_intent",
        status: "succeeded",
        amount: 22_800,
        currency: "usd",
        application_fee_amount: 684,
        metadata: {
          orbitTransactionId: transaction.id,
          merchantId: transaction.merchantId,
          wooOrderId: transaction.wooOrderId,
          paymentSource: "ECWID",
        },
      } },
    } as never)).resolves.toEqual({ processed: true });

    expect(mocks.verifyCheckoutIntent).toHaveBeenCalledWith(transaction.id, "pi_checkout_9001", "acct_core");
    expect(mocks.transactionUpdateMany).toHaveBeenCalledWith({
      where: { id: transaction.id, source: "ECWID", stripePaymentIntentId: null },
      data: { stripePaymentIntentId: "pi_checkout_9001" },
    });
    expect(mocks.transactionUpdate).toHaveBeenCalledWith({ where: { id: transaction.id }, data: { status: "SUCCEEDED" } });
    expect(mocks.syncEcwid).toHaveBeenCalledWith(transaction.id, "SUCCEEDED");
  });
});
