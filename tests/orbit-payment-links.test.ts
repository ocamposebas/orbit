import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  linkFind: vi.fn(), paymentFind: vi.fn(), paymentCreate: vi.fn(), paymentUpdate: vi.fn(), paymentUpdateMany: vi.fn(),
  intentCreate: vi.fn(), intentRetrieve: vi.fn(), intentUpdate: vi.fn(),
}));

vi.mock("@/sentinel/db", () => ({ getDatabase: () => ({
  orbitPaymentLink: { findUnique: mocks.linkFind },
  orbitPaymentLinkPayment: { findUnique: mocks.paymentFind, create: mocks.paymentCreate, update: mocks.paymentUpdate, updateMany: mocks.paymentUpdateMany },
}) }));
vi.mock("@/stripe/client", () => ({
  getStripeConfiguration: () => ({ configured: true, mode: "test", platformPaymentsWebhookConfigured: true }),
  stripeEnvironment: () => "TEST",
  getStripePublishableKey: () => "pk_test_orbit",
  getStripeClient: () => ({ paymentIntents: { create: mocks.intentCreate, retrieve: mocks.intentRetrieve, update: mocks.intentUpdate } }),
}));
vi.mock("@/payments/service", () => ({
  calculatePlatformFeeMinor: (amount: number, bps: number) => Math.round(amount * bps / 10_000),
  paymentMethodConfigurationId: () => "pmc_orbit",
}));
vi.mock("@/sentinel/logger", () => ({ childLogger: () => ({ error: vi.fn() }) }));

const platformLink = {
  id: "link_internal", publicId: "plink_abcdefghijklmnop", organizationId: "org_1", merchantId: null,
  title: "ORBIT consulting", amountMinor: 10_000, currency: "USD", platformFeeBps: null,
  stripeEnvironment: "TEST", status: "ACTIVE", expiresAt: null, merchant: null,
};
const platformPayment = {
  id: "orb_plpay_abcdefghijklmnop", publicId: "plpay_abcdefghijklmnop", paymentLinkId: platformLink.id,
  checkoutKey: "4c1b8f50-1b3a-4ef8-b727-4b2800626881", stripePaymentIntentId: null, stripeAccountId: null,
  amountMinor: 10_000, currency: "USD", platformFeeMinor: 0, status: "CREATED",
};

describe("ORBIT Payment Links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.linkFind.mockResolvedValue(platformLink);
    mocks.paymentFind.mockResolvedValue(null);
    mocks.paymentCreate.mockResolvedValue(platformPayment);
    mocks.paymentUpdate.mockImplementation(async ({ data }: { data: object }) => ({ ...platformPayment, ...data }));
    mocks.paymentUpdateMany.mockResolvedValue({ count: 1 });
    mocks.intentCreate.mockResolvedValue({
      id: "pi_platform", amount: 10_000, currency: "usd", application_fee_amount: null, livemode: false,
      payment_method_types: ["card", "link"], status: "requires_payment_method",
      client_secret: "pi_platform_secret", metadata: { paymentSource: "ORBIT_PAYMENT_LINK", orbitPaymentLinkId: platformLink.id, orbitPaymentLinkPaymentId: platformPayment.id, organizationId: "org_1" },
    });
  });

  it("creates an ORBIT-owned payment on the platform account without a connected-account context or application fee", async () => {
    const { createOrbitPaymentLinkCheckout } = await import("@/payment-links/service");
    await expect(createOrbitPaymentLinkCheckout(platformLink.publicId, platformPayment.checkoutKey)).resolves.toMatchObject({ connectedAccountId: null, paymentPublicId: platformPayment.publicId });
    const [params, options] = mocks.intentCreate.mock.calls[0];
    expect(params).not.toHaveProperty("application_fee_amount");
    expect(params).not.toHaveProperty("payment_method_configuration");
    expect(params).not.toHaveProperty("automatic_payment_methods");
    expect(params.payment_method_types).toEqual(["card", "link"]);
    expect(params.metadata).not.toHaveProperty("merchantId");
    expect(params.statement_descriptor_suffix).toBe("ORBIT");
    expect(options).not.toHaveProperty("stripeContext");
  });

  it("routes a merchant link to its exact connected account and snapshots the ORBIT fee", async () => {
    const link = { ...platformLink, id: "link_merchant", merchantId: "merchant_1", platformFeeBps: 300, merchant: { id: "merchant_1", businessName: "Client One", stripeConnect: { stripeAccountId: "acct_client_one", stripeEnvironment: "TEST", cardPaymentsStatus: "active" } } };
    const payment = { ...platformPayment, id: "orb_plpay_merchantabcdefgh", paymentLinkId: link.id, stripeAccountId: "acct_client_one", platformFeeMinor: 300 };
    mocks.linkFind.mockResolvedValue(link); mocks.paymentCreate.mockResolvedValue(payment);
    mocks.paymentUpdate.mockImplementation(async ({ data }: { data: object }) => ({ ...payment, ...data }));
    mocks.intentCreate.mockResolvedValue({ id: "pi_merchant", amount: 10_000, currency: "usd", application_fee_amount: 300, livemode: false, payment_method_types: ["card", "link"], status: "requires_payment_method", client_secret: "pi_merchant_secret", metadata: { paymentSource: "ORBIT_PAYMENT_LINK", orbitPaymentLinkId: link.id, orbitPaymentLinkPaymentId: payment.id, organizationId: "org_1", merchantId: "merchant_1" } });
    const { createOrbitPaymentLinkCheckout } = await import("@/payment-links/service");
    await createOrbitPaymentLinkCheckout(link.publicId, payment.checkoutKey);
    const [params, options] = mocks.intentCreate.mock.calls[0];
    expect(options.stripeContext).toBe("acct_client_one");
    expect(params.application_fee_amount).toBe(300);
    expect(params.payment_method_configuration).toBe("pmc_orbit");
    expect(params.payment_method_types).toEqual(["card", "link"]);
    expect(params.metadata.merchantId).toBe("merchant_1");
  });

  it("removes secondary methods from an existing open checkout", async () => {
    const payment = { ...platformPayment, stripePaymentIntentId: "pi_existing" };
    const existingIntent = {
      id: "pi_existing", amount: 10_000, currency: "usd", application_fee_amount: null, livemode: false,
      payment_method_types: ["card", "link", "affirm", "amazon_pay"], status: "requires_payment_method",
      client_secret: "pi_existing_secret", metadata: { paymentSource: "ORBIT_PAYMENT_LINK", orbitPaymentLinkId: platformLink.id, orbitPaymentLinkPaymentId: payment.id, organizationId: "org_1" },
    };
    mocks.paymentFind.mockResolvedValue(payment);
    mocks.intentRetrieve.mockResolvedValue(existingIntent);
    mocks.intentUpdate.mockResolvedValue({ ...existingIntent, payment_method_types: ["card", "link"] });
    const { createOrbitPaymentLinkCheckout } = await import("@/payment-links/service");
    await expect(createOrbitPaymentLinkCheckout(platformLink.publicId, payment.checkoutKey)).resolves.toMatchObject({ paymentPublicId: payment.publicId });
    expect(mocks.intentUpdate).toHaveBeenCalledWith("pi_existing", { payment_method_types: ["card", "link"] }, {});
    expect(mocks.intentCreate).not.toHaveBeenCalled();
  });

  it("never creates a PaymentIntent for an inactive link", async () => {
    mocks.linkFind.mockResolvedValue({ ...platformLink, status: "INACTIVE" });
    const { createOrbitPaymentLinkCheckout } = await import("@/payment-links/service");
    await expect(createOrbitPaymentLinkCheckout(platformLink.publicId, platformPayment.checkoutKey)).rejects.toMatchObject({ status: 409 });
    expect(mocks.intentCreate).not.toHaveBeenCalled();
  });
});
