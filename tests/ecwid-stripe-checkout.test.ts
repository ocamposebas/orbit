import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkoutCreate: vi.fn(),
  checkoutRetrieve: vi.fn(),
  sessionFind: vi.fn(),
  sessionUpdateMany: vi.fn(),
  transactionFind: vi.fn(),
  transactionUpdateMany: vi.fn(),
}));

vi.mock("@/sentinel/config", () => ({ getServerEnv: () => ({ STRIPE_PAYMENTS_WEBHOOK_SECRET: "whsec_test" }) }));
vi.mock("@/integrations/ecwid/config", () => ({ getEcwidPublicCheckoutOrigin: () => "https://pay.coreaminosresearch.com" }));
vi.mock("@/payments/service", () => ({ paymentMethodConfigurationId: () => "pmc_configured" }));
vi.mock("@/stripe/client", () => ({
  getStripeClient: () => ({ checkout: { sessions: { create: mocks.checkoutCreate, retrieve: mocks.checkoutRetrieve } } }),
  getStripeConfiguration: () => ({ configured: true, mode: "test" }),
  stripeEnvironment: () => "TEST",
}));
vi.mock("@/sentinel/db", () => ({ getDatabase: () => ({
  ecwidPaymentSession: { findUnique: mocks.sessionFind, updateMany: mocks.sessionUpdateMany },
  paymentTransaction: { findUnique: mocks.transactionFind, updateMany: mocks.transactionUpdateMany },
}) }));

const record = {
  id: `orb_ps_${"a".repeat(32)}`,
  merchantId: "merchant_core",
  paymentTransactionId: "orb_tx_transaction123456789",
  storeId: "10101010",
  orderId: "9001",
  referenceTransactionId: "ecwid-reference-9001",
  amountMinor: 22_800,
  currency: "USD",
  customerEmail: "buyer@example.com",
  checkoutMode: "STRIPE_CHECKOUT",
  stripeCheckoutSessionId: null,
  merchant: {
    businessName: "Core Aminos Research",
    stripeConnect: { stripeAccountId: "acct_core", stripeEnvironment: "TEST", cardPaymentsStatus: "active" },
  },
  paymentTransaction: {
    id: "orb_tx_transaction123456789",
    wooOrderId: "ecwid:10101010:hash",
    stripeAccountId: "acct_core",
    platformFeeMinor: 684,
  },
};

function checkoutSession() {
  return {
    id: "cs_test_checkout9001",
    mode: "payment",
    amount_total: 22_800,
    currency: "usd",
    client_reference_id: record.paymentTransactionId,
    metadata: {
      orbitTransactionId: record.paymentTransactionId,
      orbitPaymentSessionId: record.id,
      merchantId: record.merchantId,
      ecwidStoreId: record.storeId,
      ecwidOrderId: record.orderId,
      ecwidReferenceTransactionId: record.referenceTransactionId,
      paymentSource: "ECWID",
    },
    payment_intent: null,
    expires_at: 1_800_000_000,
    url: "https://checkout.stripe.com/c/pay/cs_test_checkout9001",
    status: "open",
    payment_status: "unpaid",
  };
}

describe("Ecwid Stripe-hosted Checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionFind.mockImplementation((args: { include?: unknown; select?: { stripeCheckoutSessionId?: boolean } }) => {
      if (args.include) return record;
      if (args.select?.stripeCheckoutSessionId) return { stripeCheckoutSessionId: "cs_test_checkout9001" };
      return null;
    });
    mocks.sessionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.checkoutCreate.mockResolvedValue(checkoutSession());
  });

  it("creates a direct connected-account Checkout Session from stored authoritative values", async () => {
    const { createOrReuseEcwidStripeCheckout } = await import("@/integrations/ecwid/stripe-checkout");
    const result = await createOrReuseEcwidStripeCheckout(record.id);

    expect(result.url).toContain("checkout.stripe.com");
    expect(mocks.checkoutCreate).toHaveBeenCalledOnce();
    const [params, options] = mocks.checkoutCreate.mock.calls[0];
    expect(params).toMatchObject({
      mode: "payment",
      client_reference_id: record.paymentTransactionId,
      customer_email: record.customerEmail,
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: 22_800 } }],
      payment_method_configuration: "pmc_configured",
      payment_intent_data: { application_fee_amount: 684, metadata: { paymentSource: "ECWID" } },
      success_url: `https://pay.coreaminosresearch.com/api/integrations/ecwid/return/${record.id}`,
      cancel_url: `https://pay.coreaminosresearch.com/api/integrations/ecwid/cancel/${record.id}`,
    });
    expect(params).not.toHaveProperty("payment_method_types");
    expect(options).toEqual({ stripeContext: "acct_core", idempotencyKey: `orbit-ecwid-checkout-${record.id}` });
    expect(mocks.sessionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: record.id, stripeCheckoutSessionId: null },
      data: expect.objectContaining({ stripeCheckoutSessionId: "cs_test_checkout9001" }),
    }));
  });
});
