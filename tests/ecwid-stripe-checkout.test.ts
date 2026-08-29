import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkoutCreate: vi.fn(),
  checkoutRetrieve: vi.fn(),
  intentRetrieve: vi.fn(),
  sessionFind: vi.fn(),
  sessionUpdateMany: vi.fn(),
  transactionFind: vi.fn(),
  transactionUpdateMany: vi.fn(),
  serverEnv: {
    STRIPE_PAYMENTS_WEBHOOK_SECRET: "whsec_test",
    ECWID_STRIPE_PAYMENT_METHOD_CONFIGURATION_ID: undefined as string | undefined,
  },
}));

vi.mock("@/sentinel/config", () => ({ getServerEnv: () => mocks.serverEnv }));
vi.mock("@/integrations/ecwid/config", () => ({ getEcwidPublicCheckoutOrigin: () => "https://pay.coreaminosresearch.com" }));
vi.mock("@/payments/service", () => ({ paymentMethodConfigurationId: () => "pmc_configured" }));
vi.mock("@/stripe/client", () => ({
  getStripeClient: () => ({
    checkout: { sessions: { create: mocks.checkoutCreate, retrieve: mocks.checkoutRetrieve } },
    paymentIntents: { retrieve: mocks.intentRetrieve },
  }),
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
    stripePaymentIntentId: null,
    status: "REQUIRES_PAYMENT",
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
    mocks.serverEnv.ECWID_STRIPE_PAYMENT_METHOD_CONFIGURATION_ID = undefined;
    mocks.sessionFind.mockImplementation((args: { include?: unknown; select?: { stripeCheckoutSessionId?: boolean } }) => {
      if (args.include) return record;
      if (args.select?.stripeCheckoutSessionId) return { stripeCheckoutSessionId: "cs_test_checkout9001" };
      return null;
    });
    mocks.sessionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.transactionUpdateMany.mockResolvedValue({ count: 1 });
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

  it("uses the Ecwid-specific payment method configuration without changing the global fallback", async () => {
    mocks.serverEnv.ECWID_STRIPE_PAYMENT_METHOD_CONFIGURATION_ID = "pmc_ecwidparent";
    const { createOrReuseEcwidStripeCheckout } = await import("@/integrations/ecwid/stripe-checkout");

    await createOrReuseEcwidStripeCheckout(record.id);

    expect(mocks.checkoutCreate).toHaveBeenCalledOnce();
    expect(mocks.checkoutCreate.mock.calls[0][0]).toMatchObject({
      payment_method_configuration: "pmc_ecwidparent",
    });
  });

  it("reuses an existing open Checkout Session without creating a second one", async () => {
    const existing = { ...record, stripeCheckoutSessionId: "cs_test_checkout9001" };
    mocks.sessionFind.mockImplementation((args: { include?: unknown }) => args.include ? existing : null);
    mocks.checkoutRetrieve.mockResolvedValue(checkoutSession());
    const { createOrReuseEcwidStripeCheckout } = await import("@/integrations/ecwid/stripe-checkout");

    const result = await createOrReuseEcwidStripeCheckout(record.id);

    expect(result.id).toBe("cs_test_checkout9001");
    expect(mocks.checkoutRetrieve).toHaveBeenCalledOnce();
    expect(mocks.checkoutCreate).not.toHaveBeenCalled();
  });

  it("replaces an expired unpaid Checkout Session on the same ORBIT transaction", async () => {
    const existing = {
      ...record,
      stripeCheckoutSessionId: "cs_test_expired9001",
      paymentTransaction: { ...record.paymentTransaction, status: "CANCELED" },
    };
    mocks.sessionFind.mockImplementation((args: { include?: unknown; select?: { stripeCheckoutSessionId?: boolean } }) => {
      if (args.include) return existing;
      if (args.select?.stripeCheckoutSessionId) return { stripeCheckoutSessionId: "cs_test_checkout9001" };
      return null;
    });
    mocks.checkoutRetrieve.mockResolvedValue({
      ...checkoutSession(), id: "cs_test_expired9001", status: "expired", payment_status: "unpaid", url: null,
    });
    const { createOrReuseEcwidStripeCheckout } = await import("@/integrations/ecwid/stripe-checkout");

    const result = await createOrReuseEcwidStripeCheckout(record.id);

    expect(result.id).toBe("cs_test_checkout9001");
    expect(mocks.checkoutCreate).toHaveBeenCalledOnce();
    expect(mocks.checkoutCreate.mock.calls[0][1]).toEqual({
      stripeContext: "acct_core",
      idempotencyKey: `${stripeCheckoutSessionIdempotencyKeyForTest(record.id)}-after-cs_test_expired9001`,
    });
    expect(mocks.transactionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: record.paymentTransactionId, source: "ECWID" }),
      data: { stripePaymentIntentId: null, status: "REQUIRES_PAYMENT" },
    }));
    expect(mocks.sessionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: record.id, stripeCheckoutSessionId: "cs_test_expired9001" },
      data: expect.objectContaining({ stripeCheckoutSessionId: "cs_test_checkout9001", status: "PENDING" }),
    }));
  });

  it("does not replace an expired Checkout Session whose PaymentIntent is still processing", async () => {
    const existing = {
      ...record,
      stripeCheckoutSessionId: "cs_test_expired9001",
      paymentTransaction: { ...record.paymentTransaction, stripePaymentIntentId: "pi_processing9001" },
    };
    mocks.sessionFind.mockImplementation((args: { include?: unknown }) => args.include ? existing : null);
    mocks.checkoutRetrieve.mockResolvedValue({
      ...checkoutSession(),
      id: "cs_test_expired9001",
      status: "expired",
      payment_status: "unpaid",
      payment_intent: "pi_processing9001",
      url: null,
    });
    mocks.intentRetrieve.mockResolvedValue({ id: "pi_processing9001", status: "processing" });
    mocks.transactionFind.mockResolvedValue({ stripePaymentIntentId: "pi_processing9001" });
    const { createOrReuseEcwidStripeCheckout } = await import("@/integrations/ecwid/stripe-checkout");

    const result = await createOrReuseEcwidStripeCheckout(record.id);

    expect(result.id).toBe("cs_test_expired9001");
    expect(mocks.intentRetrieve).toHaveBeenCalledOnce();
    expect(mocks.checkoutCreate).not.toHaveBeenCalled();
    expect(mocks.transactionUpdateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: { stripePaymentIntentId: null, status: "REQUIRES_PAYMENT" },
    }));
  });
});

function stripeCheckoutSessionIdempotencyKeyForTest(sessionId: string) {
  return `orbit-ecwid-checkout-${sessionId}`;
}
