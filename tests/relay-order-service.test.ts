import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptRelaySecret } from "@/commerce/woocommerce/crypto";
import { signOrbitRelayRequest } from "@/commerce/woocommerce/auth";

const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), fetch: vi.fn() }));
const encryptionKey = Buffer.alloc(32, 11).toString("base64");

vi.mock("@/sentinel/config", () => ({ getServerEnv: () => ({ ORBIT_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString("base64") }) }));
vi.mock("@/sentinel/db", () => ({ getDatabase: () => ({ wooCommerceRelayIntegration: { findUnique: mocks.find, update: mocks.update } }) }));
vi.mock("@/sentinel/security/ssrf", () => ({ safeFetchText: mocks.fetch }));

const merchantId = "cm12345678901234567890123";
const secret = "wordpress-relay-signing-secret";
const integration = {
  id: "relay_1",
  merchantId,
  baseUrl: "https://wp.rgvprimellc.com",
  environment: "PRODUCTION",
  connectionEnabled: true,
  encryptedSigningSecret: encryptRelaySecret(secret, merchantId, encryptionKey),
  connectionStatus: "CONNECTED",
  relayVersion: "1.0.0",
  woocommerceAvailable: true,
  lastHealthCheckAt: new Date(),
  lastSuccessfulRequestAt: null,
  lastLatencyMs: 50,
  lastErrorCode: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function response(overrides: Record<string, unknown> = {}) {
  return {
    status: 200,
    text: JSON.stringify({
      order_id: 1234,
      status: "pending",
      currency: "USD",
      total_minor: 12650,
      payment_required: true,
      paid: false,
      date_created: "2026-08-22T20:00:00-05:00",
      orbit_transaction_id: null,
      billing: { phone: "must-not-leak" },
      ...overrides,
    }),
  };
}

describe("private WooCommerce order verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.find.mockResolvedValue({ ...integration });
    mocks.update.mockResolvedValue({ ...integration, lastSuccessfulRequestAt: new Date() });
    mocks.fetch.mockResolvedValue(response());
  });

  it("decrypts the existing secret, sends a signed GET, and returns only minimal authoritative data", async () => {
    const { verifyWooCommerceOrder } = await import("@/commerce/woocommerce/service");
    const result = await verifyWooCommerceOrder(merchantId, 1234);

    expect(result).toEqual({ orderId: 1234, status: "pending", currency: "USD", totalMinor: 12650, paymentRequired: true, privateAuthentication: "VERIFIED" });
    expect(JSON.stringify(result)).not.toContain("phone");
    expect(JSON.stringify(result)).not.toContain("date_created");
    expect(JSON.stringify(result)).not.toContain("orbit_transaction_id");

    const [url, options] = mocks.fetch.mock.calls[0] as [string, { headers: Record<string, string>; [key: string]: unknown }];
    expect(url).toBe("https://wp.rgvprimellc.com/wp-json/orbit/v1/orders/1234");
    expect(url).not.toContain("/payment");
    expect(options).toMatchObject({ timeoutMs: 8_000, maxBytes: 32_768, maxRedirects: 0, accept: "application/json" });
    expect(options.headers["X-Orbit-Merchant"]).toBe(merchantId);
    expect(options.headers["X-Orbit-Nonce"]).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(options.headers["X-Orbit-Signature"]).toBe(signOrbitRelayRequest({
      merchantId,
      timestamp: Number(options.headers["X-Orbit-Timestamp"]),
      nonce: options.headers["X-Orbit-Nonce"],
      method: "GET",
      path: "/wp-json/orbit/v1/orders/1234",
      rawBody: "",
      secret,
    }));
    expect(JSON.stringify(mocks.fetch.mock.calls)).not.toContain(secret);
  });

  it.each([
    [401, "orbit_signature_invalid", "INVALID_HMAC", 401],
    [403, "orbit_merchant_mismatch", "MERCHANT_MISMATCH", 403],
    [404, "orbit_order_not_found", "ORDER_NOT_FOUND", 404],
    [503, "orbit_woocommerce_unavailable", "WOOCOMMERCE_UNAVAILABLE", 503],
  ])("maps Relay HTTP %s / %s to safe %s errors", async (status, code, expectedCode, expectedStatus) => {
    mocks.fetch.mockResolvedValueOnce({ status, text: JSON.stringify({ code, message: "private upstream detail", data: { status } }) });
    const { verifyWooCommerceOrder } = await import("@/commerce/woocommerce/service");
    await expect(verifyWooCommerceOrder(merchantId, 1234)).rejects.toMatchObject({ code: expectedCode, status: expectedStatus });
  });

  it("rejects an already-paid order safely", async () => {
    mocks.fetch.mockResolvedValueOnce(response({ status: "processing", payment_required: false, paid: true }));
    const { verifyWooCommerceOrder } = await import("@/commerce/woocommerce/service");
    await expect(verifyWooCommerceOrder(merchantId, 1234)).rejects.toMatchObject({ code: "ORDER_ALREADY_PAID", status: 409, message: "This WooCommerce order is already paid" });
  });

  it("maps timeout and unavailable failures without exposing network details", async () => {
    const { verifyWooCommerceOrder } = await import("@/commerce/woocommerce/service");
    mocks.fetch.mockRejectedValueOnce(Object.assign(new Error("socket timeout with private details"), { name: "AbortError" }));
    await expect(verifyWooCommerceOrder(merchantId, 1234)).rejects.toMatchObject({ code: "CONNECTION_TIMEOUT", status: 504, message: "WooCommerce order verification timed out" });
    mocks.fetch.mockRejectedValueOnce(Object.assign(new Error("connection refused at 10.0.0.1"), { code: "ECONNREFUSED" }));
    await expect(verifyWooCommerceOrder(merchantId, 1234)).rejects.toMatchObject({ code: "RELAY_UNAVAILABLE", status: 502, message: "The WooCommerce Relay is unavailable" });
  });

  it("does not call WooCommerce when Relay is disabled", async () => {
    mocks.find.mockResolvedValueOnce({ ...integration, connectionEnabled: false });
    const { verifyWooCommerceOrder } = await import("@/commerce/woocommerce/service");
    await expect(verifyWooCommerceOrder(merchantId, 1234)).rejects.toMatchObject({ code: "RELAY_DISABLED", status: 409 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
