import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), fetch: vi.fn() }));

vi.mock("@/sentinel/db", () => ({ getDatabase: () => ({ wooCommerceRelayIntegration: { findUnique: mocks.find, update: mocks.update } }) }));
vi.mock("@/sentinel/security/ssrf", () => ({ safeFetchText: mocks.fetch }));

const integration = {
  id: "relay_1", merchantId: "merchant_1", baseUrl: "https://wp.example.com", environment: "PRODUCTION", connectionEnabled: true,
  encryptedSigningSecret: "v1:encrypted", connectionStatus: "CONFIGURED", relayVersion: null, woocommerceAvailable: null,
  lastHealthCheckAt: null, lastSuccessfulRequestAt: null, lastLatencyMs: null, lastErrorCode: null, createdAt: new Date(), updatedAt: new Date(),
};

describe("WooCommerce Relay health service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.find.mockResolvedValue({ ...integration });
    mocks.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...integration, ...data, updatedAt: new Date() }));
  });

  it("normalizes a successful Relay and WooCommerce health response without sending the signing secret", async () => {
    mocks.fetch.mockResolvedValue({ status: 200, text: JSON.stringify({ ok: true, service: "orbit-relay", woocommerce: true, version: "1.0.0" }) });
    const { checkWooCommerceRelayHealth } = await import("@/commerce/woocommerce/service");
    const result = await checkWooCommerceRelayHealth("merchant_1");
    expect(result).toMatchObject({ ok: true, connectionStatus: "CONNECTED", relayVersion: "1.0.0", woocommerceAvailable: true, signingConfigured: true, lastErrorCode: null });
    expect(mocks.fetch).toHaveBeenCalledWith("https://wp.example.com/wp-json/orbit/v1/health", { timeoutMs: 6_000, maxBytes: 32_768, maxRedirects: 0, accept: "application/json" });
    expect(JSON.stringify(mocks.fetch.mock.calls)).not.toContain("v1:encrypted");
  });

  it("maps woocommerce=false to WOO_UNAVAILABLE", async () => {
    mocks.fetch.mockResolvedValue({ status: 200, text: JSON.stringify({ ok: true, service: "orbit-relay", woocommerce: false, version: "1.0.0" }) });
    const { checkWooCommerceRelayHealth } = await import("@/commerce/woocommerce/service");
    expect(await checkWooCommerceRelayHealth("merchant_1")).toMatchObject({ ok: false, connectionStatus: "WOO_UNAVAILABLE", lastErrorCode: "WOOCOMMERCE_UNAVAILABLE" });
  });

  it("rejects an invalid Relay response", async () => {
    mocks.fetch.mockResolvedValue({ status: 200, text: JSON.stringify({ ok: true, service: "another-service", woocommerce: true }) });
    const { checkWooCommerceRelayHealth } = await import("@/commerce/woocommerce/service");
    expect(await checkWooCommerceRelayHealth("merchant_1")).toMatchObject({ ok: false, connectionStatus: "ERROR", lastErrorCode: "INVALID_RELAY_RESPONSE" });
  });

  it("normalizes timeouts", async () => {
    mocks.fetch.mockRejectedValue(Object.assign(new Error("request timeout"), { name: "AbortError" }));
    const { checkWooCommerceRelayHealth } = await import("@/commerce/woocommerce/service");
    expect(await checkWooCommerceRelayHealth("merchant_1")).toMatchObject({ ok: false, connectionStatus: "UNREACHABLE", lastErrorCode: "CONNECTION_TIMEOUT" });
  });

  it("normalizes unreachable hosts", async () => {
    mocks.fetch.mockRejectedValue(Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" }));
    const { checkWooCommerceRelayHealth } = await import("@/commerce/woocommerce/service");
    expect(await checkWooCommerceRelayHealth("merchant_1")).toMatchObject({ ok: false, connectionStatus: "UNREACHABLE", lastErrorCode: "RELAY_UNAVAILABLE" });
  });

  it("does not call the endpoint while Relay is disabled", async () => {
    mocks.find.mockResolvedValueOnce({ ...integration, connectionEnabled: false });
    const { checkWooCommerceRelayHealth } = await import("@/commerce/woocommerce/service");
    await expect(checkWooCommerceRelayHealth("merchant_1")).rejects.toMatchObject({ code: "RELAY_DISABLED", status: 409 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
