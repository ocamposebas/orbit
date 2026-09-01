import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eventCreate: vi.fn(), eventFind: vi.fn(), eventUpdate: vi.fn(), transactionFind: vi.fn(), transactionUpdate: vi.fn(), transactionUpdateMany: vi.fn(),
  sessionFind: vi.fn(), sessionUpdateMany: vi.fn(), recordSuccess: vi.fn(), deliver: vi.fn(),
}));
vi.mock("@/sentinel/db", () => ({ getDatabase: () => ({
  stripePaymentEvent: { create: mocks.eventCreate, findUnique: mocks.eventFind, update: mocks.eventUpdate },
  paymentTransaction: { findUnique: mocks.transactionFind, update: mocks.transactionUpdate, updateMany: mocks.transactionUpdateMany },
  paymentSession: { findUnique: mocks.sessionFind, updateMany: mocks.sessionUpdateMany },
}) }));
vi.mock("@/stripe/client", () => ({ expectedLivemode: () => false, getStripeConfiguration: () => ({ mode: "test" }) }));
vi.mock("@/commerce/woocommerce/events", () => ({ recordWooCommercePaymentSucceeded: mocks.recordSuccess, deliverWooCommercePaymentEvent: mocks.deliver }));
vi.mock("@/commerce/woocommerce/service", () => ({ completeWooCommerceOrderPayment: vi.fn() }));
vi.mock("@/integrations/ecwid/service", () => ({ syncEcwidForTransaction: vi.fn() }));
vi.mock("@/integrations/ecwid/stripe-checkout", () => ({ verifyEcwidCheckoutPaymentIntent: vi.fn() }));

const transaction = { id: "orb_tx_transaction123456789", publicPaymentId: "pay_payment123456789", merchantId: "merchant_1", wooOrderId: "woocommerce:ins_installation123456:5829", stripeAccountId: "acct_1", stripePaymentIntentId: "pi_1", amountMinor: 11902, currency: "USD", platformFeeMinor: 357, source: "WOOCOMMERCE", wooCompletedAt: null };
const session = { id: "ops_session1234567890123456789012", installationId: "ins_installation123456", platformOrderId: "5829" };
function event() { return { id: "evt_woo_success", type: "payment_intent.succeeded", account: "acct_1", livemode: false, data: { object: { id: "pi_1", object: "payment_intent", status: "succeeded", amount: 11902, currency: "usd", application_fee_amount: 357, metadata: { orbitTransactionId: transaction.id, merchantId: transaction.merchantId, wooOrderId: "5829", paymentSource: "WOOCOMMERCE", installationId: session.installationId, orbitSessionId: session.id, transactionReference: transaction.wooOrderId } } } }; }

describe("WooCommerce hosted payment webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eventCreate.mockResolvedValue({ id: "payment_event", status: "PROCESSING" }); mocks.eventUpdate.mockResolvedValue({});
    mocks.transactionFind.mockResolvedValue(transaction); mocks.transactionUpdate.mockResolvedValue({}); mocks.sessionFind.mockResolvedValue(session);
    mocks.recordSuccess.mockResolvedValue({ id: "evt_stable123456789" }); mocks.deliver.mockResolvedValue({ delivered: true });
  });

  it("resolves the hosted session and enqueues its signed success event", async () => {
    const { handleStripePaymentEvent } = await import("@/payments/webhook");
    await expect(handleStripePaymentEvent(event() as never)).resolves.toEqual({ processed: true });
    expect(mocks.recordSuccess).toHaveBeenCalledWith({ transactionId: transaction.id, stripePaymentIntentId: "pi_1" });
    expect(mocks.deliver).toHaveBeenCalledWith("evt_stable123456789");
  });

  it("acknowledges an already-processed Stripe event without completing twice", async () => {
    mocks.eventCreate.mockRejectedValueOnce(new Error("unique"));
    mocks.eventFind.mockResolvedValueOnce({ id: "payment_event", status: "PROCESSED" });
    const { handleStripePaymentEvent } = await import("@/payments/webhook");
    await expect(handleStripePaymentEvent(event() as never)).resolves.toEqual({ duplicate: true });
    expect(mocks.recordSuccess).not.toHaveBeenCalled();
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
});
