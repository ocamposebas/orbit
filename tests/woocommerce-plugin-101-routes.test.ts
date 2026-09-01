import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ exchange: vi.fn(), authenticate: vi.fn(), installationUpdate: vi.fn(), rateLimit: vi.fn() }));
vi.mock("@/commerce/woocommerce/installations", () => ({ exchangeWooCommerceConnectionCode: mocks.exchange }));
vi.mock("@/commerce/woocommerce/request-auth", () => ({ authenticateWooCommerceRequest: mocks.authenticate }));
vi.mock("@/sentinel/db", () => ({ getDatabase: () => ({ wooCommerceInstallation: { update: mocks.installationUpdate } }) }));
vi.mock("@/sentinel/rate-limit", () => ({ enforceRateLimit: mocks.rateLimit }));

describe("WooCommerce plugin 1.0.1 public routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exchange.mockResolvedValue({ merchant_id: "mrc_merchant123456", installation_id: "ins_installation123456", installation_secret: "s".repeat(43), environment: "live" });
    mocks.authenticate.mockResolvedValue({ id: "ins_installation123456" });
    mocks.installationUpdate.mockResolvedValue({});
  });

  it("accepts the plugin's exact connection exchange body and response validation", async () => {
    const { POST } = await import("@/app/v1/woocommerce/installations/exchange/route");
    const body = {
      connection_code: "orb_live_abcdefghijkl",
      site_url: "https://shop.example/",
      callback_url: "https://shop.example/wp-json/orbit-payments/v1/events",
      health_url: "https://shop.example/wp-json/orbit-payments/v1/health",
      plugin_version: "1.0.1",
      wordpress_version: "6.8.2",
      woocommerce_version: "10.4.0",
    };
    const response = await POST(new NextRequest("https://api.orbit.example/v1/woocommerce/installations/exchange", { method: "POST", body: JSON.stringify(body) }));
    const result = await response.json() as Record<string, string>;
    expect(response.status).toBe(200);
    expect(result).toEqual({ merchant_id: "mrc_merchant123456", installation_id: "ins_installation123456", installation_secret: "s".repeat(43), environment: "live" });
    expect(result.merchant_id).toMatch(/^mrc_[A-Za-z0-9_-]{6,}$/);
    expect(result.installation_id).toMatch(/^ins_[A-Za-z0-9_-]{6,}$/);
    expect(result.installation_secret.length).toBeGreaterThanOrEqual(32);
    expect(["test", "live"]).toContain(result.environment);
  });

  it("accepts the plugin's exact signed heartbeat body including site_url", async () => {
    const { POST } = await import("@/app/v1/woocommerce/installations/heartbeat/route");
    const rawBody = JSON.stringify({
      site_url: "https://shop.example/",
      plugin_version: "1.0.1",
      wordpress_version: "6.8.2",
      woocommerce_version: "10.4.0",
    });
    const request = new NextRequest("https://api.orbit.example/v1/woocommerce/installations/heartbeat", { method: "POST", body: rawBody });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mocks.authenticate).toHaveBeenCalledWith(request, rawBody);
    expect(mocks.installationUpdate).toHaveBeenCalledWith({ where: { id: "ins_installation123456" }, data: expect.objectContaining({ pluginVersion: "1.0.1", wordPressVersion: "6.8.2", wooCommerceVersion: "10.4.0" }) });
  });
});
