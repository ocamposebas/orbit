import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessionFind: vi.fn(),
  sessionUpdate: vi.fn(),
  checkoutReuse: vi.fn(),
  encryptReturnUrl: vi.fn((returnUrl: string, sessionId: string) => `encrypted:${sessionId}:${returnUrl}`),
}));

vi.mock("@/sentinel/db", () => ({ getDatabase: () => ({
  ecwidPaymentSession: { findUnique: mocks.sessionFind, update: mocks.sessionUpdate },
}) }));
vi.mock("@/integrations/ecwid/config", () => ({
  ecwidEnabled: () => true,
  getEcwidConfiguration: () => ({
    enabled: true,
    storeId: "10101010",
    clientId: "ecwid-client",
    clientSecret: "private-ecwid-secret",
    secretToken: "configured-token",
    merchantId: "merchant_core",
    checkoutMode: "STRIPE_CHECKOUT",
  }),
}));
vi.mock("@/integrations/ecwid/storage", () => ({
  encryptEcwidReturnUrl: mocks.encryptReturnUrl,
  decryptEcwidReturnUrl: vi.fn(),
}));
vi.mock("@/integrations/ecwid/stripe-checkout", () => ({
  createOrReuseEcwidStripeCheckout: mocks.checkoutReuse,
  expireEcwidStripeCheckout: vi.fn(),
  retrieveEcwidStripeCheckout: vi.fn(),
}));
vi.mock("@/integrations/ecwid/client", () => ({ updateEcwidPaymentStatus: vi.fn(), EcwidApiError: class extends Error {} }));
vi.mock("@/payments/service", () => ({
  calculatePlatformFeeMinor: vi.fn(),
  createPaymentCheckoutForTransaction: vi.fn(),
  refreshPaymentTransactionFromStripe: vi.fn(),
}));
vi.mock("@/sentinel/logger", () => ({ childLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

const session = {
  id: `orb_ps_${"a".repeat(32)}`,
  merchantId: "merchant_core",
  paymentTransactionId: "orb_tx_transaction123456789",
  storeId: "10101010",
  orderId: "9001",
  referenceTransactionId: "ecwid-reference-9001",
  amountMinor: 22_800,
  currency: "USD",
  customerEmail: "buyer@example.com",
  encryptedReturnUrl: "encrypted:original",
  checkoutMode: "STRIPE_CHECKOUT",
  stripeCheckoutSessionId: "cs_test_checkout9001",
  paymentTransaction: { id: "orb_tx_transaction123456789", status: "REQUIRES_PAYMENT" },
};

function payload(returnUrl: string, total: number | string = 228) {
  return {
    storeId: "10101010",
    returnUrl,
    token: "configured-token",
    cart: {
      currency: "USD",
      order: {
        id: "9001",
        referenceTransactionId: "ecwid-reference-9001",
        total,
        email: "new-email@example.com",
      },
    },
  };
}

describe("Ecwid payment request re-entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionFind.mockImplementation((args: { where: { storeId_referenceTransactionId?: unknown; id?: string } }) => (
      args.where.storeId_referenceTransactionId ? session : { checkoutMode: "STRIPE_CHECKOUT" }
    ));
    mocks.sessionUpdate.mockImplementation((args: { data: { encryptedReturnUrl: string } }) => ({
      ...session,
      encryptedReturnUrl: args.data.encryptedReturnUrl,
    }));
    mocks.checkoutReuse.mockResolvedValue({
      id: "cs_test_checkout9001",
      url: "https://checkout.stripe.com/c/pay/cs_test_checkout9001",
      status: "open",
      paymentStatus: "unpaid",
      callbackUrl: `https://pay.example.test/api/integrations/ecwid/return/${session.id}`,
    });
  });

  it("Ecwid request -> Stripe Checkout open -> same payment request/re-entry reuses the session without conflict", async () => {
    const { createOrReuseEcwidPaymentSession, ecwidPaymentRedirect } = await import("@/integrations/ecwid/service");
    const firstReturnUrl = "https://app.ecwid.com/custompaymentapps/returnUrl?clientId=ecwid-client&timestamp=1&key=first";
    const secondReturnUrl = "https://app.ecwid.com/custompaymentapps/returnUrl?clientId=ecwid-client&timestamp=2&key=second";

    const first = await createOrReuseEcwidPaymentSession(payload(firstReturnUrl));
    const firstRedirect = await ecwidPaymentRedirect(first.id);
    const reentry = await createOrReuseEcwidPaymentSession(payload(secondReturnUrl));
    const secondRedirect = await ecwidPaymentRedirect(reentry.id);

    expect(reentry.id).toBe(first.id);
    expect(firstRedirect).toBe("https://checkout.stripe.com/c/pay/cs_test_checkout9001");
    expect(secondRedirect).toBe(firstRedirect);
    expect(mocks.checkoutReuse).toHaveBeenCalledTimes(2);
    expect(mocks.sessionUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: session.id },
      data: { encryptedReturnUrl: `encrypted:${session.id}:${secondReturnUrl}` },
    }));
  });

  it("returns conflict for the same referenceTransactionId with a different amount", async () => {
    const { createOrReuseEcwidPaymentSession } = await import("@/integrations/ecwid/service");

    await expect(createOrReuseEcwidPaymentSession(payload(
      "https://app.ecwid.com/custompaymentapps/returnUrl?clientId=ecwid-client&timestamp=2&key=second",
      229,
    ))).rejects.toMatchObject({ status: 409, message: "This Ecwid payment request conflicts with an existing session" });
    expect(mocks.sessionUpdate).not.toHaveBeenCalled();
  });

  it("routes a completed Checkout Session through the Ecwid completion callback", async () => {
    mocks.checkoutReuse.mockResolvedValue({
      id: "cs_test_checkout9001",
      url: "https://checkout.stripe.com/c/pay/cs_test_checkout9001",
      status: "complete",
      paymentStatus: "paid",
      callbackUrl: `https://pay.example.test/api/integrations/ecwid/return/${session.id}`,
    });
    const { ecwidPaymentRedirect } = await import("@/integrations/ecwid/service");

    await expect(ecwidPaymentRedirect(session.id)).resolves.toBe(
      `https://pay.example.test/api/integrations/ecwid/return/${session.id}`,
    );
  });
});
