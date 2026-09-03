import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ eventCreate: vi.fn(), eventFind: vi.fn(), eventUpdate: vi.fn(), paymentFind: vi.fn(), paymentUpdate: vi.fn(), paymentUpdateMany: vi.fn() }));
vi.mock("@/sentinel/db", () => ({ getDatabase: () => ({
  stripePaymentEvent: { create: mocks.eventCreate, findUnique: mocks.eventFind, update: mocks.eventUpdate },
  orbitPaymentLinkPayment: { findUnique: mocks.paymentFind, update: mocks.paymentUpdate, updateMany: mocks.paymentUpdateMany },
}) }));
vi.mock("@/stripe/client", () => ({ expectedLivemode: () => false, getStripeConfiguration: () => ({ mode: "test" }) }));
vi.mock("@/commerce/woocommerce/events", () => ({ recordWooCommercePaymentSucceeded: vi.fn(), deliverWooCommercePaymentEvent: vi.fn() }));
vi.mock("@/commerce/woocommerce/service", () => ({ completeWooCommerceOrderPayment: vi.fn() }));
vi.mock("@/integrations/ecwid/service", () => ({ syncEcwidForTransaction: vi.fn() }));
vi.mock("@/integrations/ecwid/stripe-checkout", () => ({ verifyEcwidCheckoutPaymentIntent: vi.fn() }));

const payment = {
  id: "orb_plpay_abcdefghijklmnop", publicId: "plpay_abcdefghijklmnop", paymentLinkId: "link_1",
  stripePaymentIntentId: "pi_orbit_link", stripeAccountId: null, amountMinor: 12500, currency: "USD", platformFeeMinor: 0,
  paymentLink: { id: "link_1", organizationId: "org_1", merchantId: null },
};
function paymentEvent(account?: string) {
  return { id: account ? "evt_wrong_destination" : "evt_orbit_link", type: "payment_intent.succeeded", ...(account ? { account } : {}), livemode: false, data: { object: {
    id: "pi_orbit_link", object: "payment_intent", status: "succeeded", amount: 12500, currency: "usd", application_fee_amount: null,
    receipt_email: " Buyer@Example.com ", metadata: { paymentSource: "ORBIT_PAYMENT_LINK", orbitPaymentLinkId: "link_1", orbitPaymentLinkPaymentId: payment.id, organizationId: "org_1" },
  } } };
}

describe("ORBIT Payment Link webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eventCreate.mockResolvedValue({ id: "event_record", status: "PROCESSING" });
    mocks.eventUpdate.mockResolvedValue({}); mocks.paymentFind.mockResolvedValue(payment); mocks.paymentUpdate.mockResolvedValue({}); mocks.paymentUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("records a platform-owned link payment only after Stripe success is verified", async () => {
    const { handleStripePaymentEvent } = await import("@/payments/webhook");
    await expect(handleStripePaymentEvent(paymentEvent() as never)).resolves.toEqual({ processed: true });
    expect(mocks.paymentUpdate).toHaveBeenCalledWith({ where: { id: payment.id }, data: { status: "SUCCEEDED", failureCode: null, customerEmail: "buyer@example.com" } });
    expect(mocks.eventUpdate).toHaveBeenCalledWith({ where: { id: "event_record" }, data: expect.objectContaining({ orbitPaymentLinkPaymentId: payment.id, stripeAccountId: null }) });
  });

  it("rejects an event delivered for the wrong Stripe destination", async () => {
    const { handleStripePaymentEvent } = await import("@/payments/webhook");
    await expect(handleStripePaymentEvent(paymentEvent("acct_wrong") as never)).rejects.toThrow("payment_link_destination_mismatch");
    expect(mocks.paymentUpdate).not.toHaveBeenCalled();
    expect(mocks.eventUpdate).toHaveBeenLastCalledWith({ where: { id: "event_record" }, data: expect.objectContaining({ status: "FAILED", errorCode: "payment_link_destination_mismatch" }) });
  });
});
