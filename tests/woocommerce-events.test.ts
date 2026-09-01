import { beforeEach, describe, expect, it, vi } from "vitest";
import { signWooCommerceRequest } from "@/commerce/woocommerce/auth";

const mocks = vi.hoisted(() => ({
  sessionFind: vi.fn(), eventCreate: vi.fn(), eventFind: vi.fn(), eventUpdate: vi.fn(), transaction: vi.fn(), sessionUpdate: vi.fn(),
  transactionUpdateMany: vi.fn(), installationUpdate: vi.fn(), safeFetch: vi.fn(),
}));
const tx = { paymentSession: { update: mocks.sessionUpdate }, paymentEventDelivery: { create: mocks.eventCreate } };
vi.mock("@/sentinel/db", () => ({ getDatabase: () => ({
  paymentSession: { findUnique: mocks.sessionFind, update: mocks.sessionUpdate },
  paymentEventDelivery: { create: mocks.eventCreate, findUnique: mocks.eventFind, update: mocks.eventUpdate, findMany: vi.fn(), },
  paymentTransaction: { updateMany: mocks.transactionUpdateMany }, wooCommerceInstallation: { update: mocks.installationUpdate },
  wooCommerceRequestNonce: { deleteMany: vi.fn() }, $transaction: mocks.transaction,
}) }));
vi.mock("@/sentinel/security/ssrf", () => ({ safeFetchText: mocks.safeFetch }));
vi.mock("@/commerce/woocommerce/installation-crypto", () => ({ decryptInstallationSecret: () => "installation-secret" }));

describe("WooCommerce payment event outbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (arg: unknown) => Array.isArray(arg) ? Promise.all(arg) : (arg as (value: typeof tx) => unknown)(tx));
    mocks.sessionUpdate.mockResolvedValue({}); mocks.eventUpdate.mockResolvedValue({}); mocks.transactionUpdateMany.mockResolvedValue({ count: 1 }); mocks.installationUpdate.mockResolvedValue({});
  });

  it("creates the signed payment.succeeded payload with one durable event ID", async () => {
    mocks.sessionFind.mockResolvedValue({ id: "ops_session1234567890123456789012", merchantId: "merchant_1", merchant: { publicId: "mrc_merchant123456" }, installationId: "ins_installation123456", paymentTransactionId: "orb_tx_transaction123456789", paymentTransaction: { publicPaymentId: "pay_payment123456789" }, platform: "WOOCOMMERCE", platformOrderId: "5829", amountMinor: 11902, currency: "USD" });
    mocks.eventCreate.mockImplementation(async ({ data }) => data);
    const { recordWooCommercePaymentSucceeded } = await import("@/commerce/woocommerce/events");
    const delivery = await recordWooCommercePaymentSucceeded({ transactionId: "orb_tx_transaction123456789", stripePaymentIntentId: "pi_1" });
    expect(delivery?.id).toMatch(/^evt_/);
    expect(delivery?.payload).toEqual({ id: delivery?.id, type: "payment.succeeded", merchant_id: "mrc_merchant123456", installation_id: "ins_installation123456", order_id: 5829, orbit_session_id: "ops_session1234567890123456789012", orbit_payment_id: "pay_payment123456789", amount_minor: 11902, currency: "USD", occurred_at: expect.any(String) });
  });

  it("delivers with installation HMAC and records only safe response metadata", async () => {
    const payload = { id: "evt_stable123456789", type: "payment.succeeded", merchant_id: "mrc_merchant123456", installation_id: "ins_installation123456", order_id: 5829, orbit_session_id: "ops_session1234567890123456789012", orbit_payment_id: "pay_payment123456789", amount_minor: 11902, currency: "USD", occurred_at: new Date().toISOString() };
    mocks.eventFind.mockResolvedValue({ id: payload.id, merchantId: "merchant_1", merchant: { publicId: payload.merchant_id }, installationId: payload.installation_id, paymentSessionId: payload.orbit_session_id, payload, status: "PENDING", attempts: 0, installation: { id: payload.installation_id, origin: "https://shop.example", encryptedSigningSecret: "encrypted", enabled: true, revokedAt: null }, paymentSession: { paymentTransactionId: "orb_tx_transaction123456789" } });
    mocks.safeFetch.mockResolvedValue({ url: new URL("https://shop.example/wp-json/orbit-payments/v1/events"), status: 200, text: JSON.stringify({ ok: true }) });
    const { deliverWooCommercePaymentEvent } = await import("@/commerce/woocommerce/events");
    await expect(deliverWooCommercePaymentEvent(payload.id)).resolves.toEqual({ delivered: true });
    const request = mocks.safeFetch.mock.calls[0][1];
    const timestamp = Number(request.headers["X-Orbit-Timestamp"]);
    expect(request.headers["X-Orbit-Signature"]).toBe(signWooCommerceRequest({ merchantId: payload.merchant_id, installationId: payload.installation_id, timestamp, nonce: request.headers["X-Orbit-Nonce"], method: "POST", path: "/wp-json/orbit-payments/v1/events", rawBody: JSON.stringify(payload), secret: "installation-secret" }));
    expect(mocks.eventUpdate).toHaveBeenCalledWith({ where: { id: payload.id }, data: expect.objectContaining({ status: "DELIVERED", lastHttpStatus: 200, lastErrorCode: null }) });
  });
});
