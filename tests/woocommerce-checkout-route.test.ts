import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), createSession: vi.fn(), checkoutUrl: vi.fn(), rateLimit: vi.fn() }));
vi.mock("@/commerce/woocommerce/request-auth", () => ({ authenticateWooCommerceRequest: mocks.authenticate }));
vi.mock("@/commerce/woocommerce/hosted-payments", () => ({
  createOrReuseWooCommercePaymentSession: mocks.createSession,
  wooCommerceCheckoutUrl: mocks.checkoutUrl,
}));
vi.mock("@/sentinel/rate-limit", () => ({ enforceRateLimit: mocks.rateLimit }));

const installation = { id: "ins_installation123456", publicMerchantId: "mrc_merchant123456" };
const body = {
  platform: "woocommerce",
  merchant_id: installation.publicMerchantId,
  installation_id: installation.id,
  order: { id: 5829, number: "5829", key: "wc_order_key", currency: "USD", amount_minor: 11902, items: [], customer: {} },
  return_url: "https://shop.example/checkout/order-received/5829/?key=wc_order_key",
  cancel_url: "https://shop.example/checkout/",
  callback_url: "https://shop.example/wp-json/orbit-payments/v1/events",
  idempotency_key: "orbit-order-5829",
};

describe("WooCommerce checkout-session v1 route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue(installation);
    mocks.createSession.mockResolvedValue({ id: "ops_session123456", expiresAt: new Date("2026-09-01T18:00:00.000Z") });
    mocks.checkoutUrl.mockReturnValue("https://pay.orbit.example/p/ops_session123456");
  });

  it("accepts the canonical plugin envelope and returns only canonical response fields", async () => {
    const { POST } = await import("@/app/v1/woocommerce/checkout-sessions/route");
    const rawBody = JSON.stringify(body);
    const response = await POST(new NextRequest("https://orbit.example/v1/woocommerce/checkout-sessions", { method: "POST", body: rawBody }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "ops_session123456", checkout_url: "https://pay.orbit.example/p/ops_session123456", expires_at: "2026-09-01T18:00:00.000Z" });
    expect(mocks.authenticate).toHaveBeenCalledWith(expect.any(NextRequest), rawBody);
    expect(mocks.createSession).toHaveBeenCalledWith({ installation, orderId: "5829", returnUrl: body.return_url, cancelUrl: body.cancel_url, callbackUrl: body.callback_url, pluginIdempotencyKey: body.idempotency_key });
  });

  it("rejects the legacy flat order aliases", async () => {
    const { POST } = await import("@/app/v1/woocommerce/checkout-sessions/route");
    const response = await POST(new NextRequest("https://orbit.example/v1/woocommerce/checkout-sessions", { method: "POST", body: JSON.stringify({ order_id: 5829, success_return_url: body.return_url }) }));
    expect(response.status).toBe(400);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
