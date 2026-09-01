import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(), sessionFind: vi.fn(), merchantFind: vi.fn(), transaction: vi.fn(),
  paymentCreate: vi.fn(), sessionCreate: vi.fn(), sessionUpdate: vi.fn(), transactionUpdate: vi.fn(),
}));
const tx = { paymentTransaction: { create: mocks.paymentCreate, update: mocks.transactionUpdate }, paymentSession: { create: mocks.sessionCreate, update: mocks.sessionUpdate } };
vi.mock("@/sentinel/security/ssrf", () => ({ safeFetchText: mocks.safeFetch }));
vi.mock("@/sentinel/db", () => ({ getDatabase: () => ({
  paymentSession: { findUnique: mocks.sessionFind, update: mocks.sessionUpdate },
  paymentTransaction: { update: mocks.transactionUpdate }, merchant: { findUnique: mocks.merchantFind }, $transaction: mocks.transaction,
}) }));
vi.mock("@/commerce/woocommerce/installation-crypto", () => ({
  decryptInstallationSecret: () => "secret", encryptWooCommerceValue: (value: string) => `encrypted:${value}`, decryptWooCommerceValue: (value: string) => value,
}));
vi.mock("@/payments/service", () => ({ calculatePlatformFeeMinor: (amount: number, bps: number) => Math.round(amount * bps / 10_000), createPaymentCheckoutForTransaction: vi.fn() }));

const installation = { id: "ins_installation1234567890", merchantId: "merchant_1", publicMerchantId: "mrc_merchant1234567890", origin: "https://shop.example", environment: "LIVE" as const, encryptedSigningSecret: "encrypted", enabled: true, hostedPaymentsEnabled: true, revokedAt: null };
function order(overrides: Record<string, unknown> = {}) { return { order_id: 5829, order_number: "5829", status: "pending", currency: "USD", total_minor: 11902, payment_required: true, paid: false, date_created: "2026-09-01T12:00:00Z", orbit_session_id: "", orbit_payment_id: "", ...overrides }; }
const request = { installation, orderId: "5829", returnUrl: "https://shop.example/checkout/order-received/5829/?key=wc_key", cancelUrl: "https://shop.example/checkout/", callbackUrl: "https://shop.example/wp-json/orbit-payments/v1/events", pluginIdempotencyKey: "orbit-order-5829" };

describe("WooCommerce hosted payment sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.safeFetch.mockImplementation(async () => ({ url: new URL("https://shop.example/wp-json/orbit-payments/v1/orders/5829"), status: 200, text: JSON.stringify(order()) }));
    mocks.sessionFind.mockResolvedValue(null);
    mocks.merchantFind.mockResolvedValue({ id: "merchant_1", platformFeeBps: 300, stripeConnect: { stripeAccountId: "acct_1", cardPaymentsStatus: "active" } });
    mocks.paymentCreate.mockResolvedValue({}); mocks.sessionCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (arg: unknown) => Array.isArray(arg) ? Promise.all(arg) : (arg as (value: typeof tx) => unknown)(tx));
  });

  it("uses the authoritative WordPress total when creating the ORBIT transaction", async () => {
    const { createOrReuseWooCommercePaymentSession, isHostedPaymentSessionId } = await import("@/commerce/woocommerce/hosted-payments");
    const result = await createOrReuseWooCommercePaymentSession(request);
    expect(result.id).toMatch(/^ops_/);
    expect(isHostedPaymentSessionId(result.id)).toBe(true);
    expect(isHostedPaymentSessionId("ors_existing123456")).toBe(true);
    expect(mocks.paymentCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ publicPaymentId: expect.stringMatching(/^pay_/), amountMinor: 11902, currency: "USD", platformFeeMinor: 357, externalReference: "5829", source: "WOOCOMMERCE" }) });
    expect(mocks.safeFetch.mock.calls[0][1].headers).toMatchObject({ "X-Orbit-Installation": installation.id });
  });

  it("reuses the same session for a duplicate unpaid order request", async () => {
    mocks.sessionFind.mockResolvedValue({ id: "ops_existing1234567890123456789012", merchantId: "merchant_1", installationId: installation.id, platformOrderId: "5829", paymentTransactionId: "orb_tx_existing123456789", amountMinor: 11902, currency: "USD", expiresAt: new Date(), paymentTransaction: { publicPaymentId: "pay_existing123456789", status: "REQUIRES_PAYMENT", stripePaymentIntentId: null, platformFeeBps: 300 } });
    mocks.sessionUpdate.mockResolvedValue({}); mocks.transactionUpdate.mockResolvedValue({});
    const { createOrReuseWooCommercePaymentSession } = await import("@/commerce/woocommerce/hosted-payments");
    const result = await createOrReuseWooCommercePaymentSession(request);
    expect(result.id).toBe("ops_existing1234567890123456789012");
    expect(mocks.paymentCreate).not.toHaveBeenCalled();
  });

  it("rejects an already-paid or non-payable authoritative order", async () => {
    mocks.safeFetch.mockResolvedValueOnce({ url: new URL("https://shop.example/wp-json/orbit-payments/v1/orders/5829"), status: 200, text: JSON.stringify(order({ paid: true, payment_required: false, status: "completed" })) });
    const { createOrReuseWooCommercePaymentSession } = await import("@/commerce/woocommerce/hosted-payments");
    await expect(createOrReuseWooCommercePaymentSession(request)).rejects.toMatchObject({ status: 409 });
    expect(mocks.paymentCreate).not.toHaveBeenCalled();
    mocks.safeFetch.mockResolvedValueOnce({ url: new URL("https://shop.example/wp-json/orbit-payments/v1/orders/5829"), status: 200, text: JSON.stringify(order({ currency: "ZZZ" })) });
    await expect(createOrReuseWooCommercePaymentSession(request)).rejects.toMatchObject({ status: 422 });
  });

  it("rejects a customer return URL outside the registered installation origin", async () => {
    const { createOrReuseWooCommercePaymentSession } = await import("@/commerce/woocommerce/hosted-payments");
    await expect(createOrReuseWooCommercePaymentSession({ ...request, returnUrl: "https://evil.example/paid" })).rejects.toMatchObject({ status: 422 });
  });
});
