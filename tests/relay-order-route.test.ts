import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAccess: vi.fn(), rateLimit: vi.fn(), verify: vi.fn(), audit: vi.fn() }));

vi.mock("@/sentinel/http", () => {
  class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
  return { HttpError, requireMerchantAccess: mocks.requireAccess };
});
vi.mock("@/sentinel/rate-limit", () => ({ enforceRateLimit: mocks.rateLimit }));
vi.mock("@/commerce/woocommerce/service", () => ({ verifyWooCommerceOrder: mocks.verify }));
vi.mock("@/commerce/woocommerce/http", () => ({
  relayErrorCode: (error: { code?: string }) => error.code ?? "UNKNOWN",
  relayApiError: (error: { status?: number; message?: string; code?: string; name?: string }) => Response.json(
    { error: error.name === "ZodError" ? "Invalid request" : error.message ?? "Unexpected server error", ...(error.code ? { code: error.code } : {}) },
    { status: error.name === "ZodError" ? 400 : error.status ?? 500 },
  ),
}));
vi.mock("@/sentinel/db", () => ({ getDatabase: () => ({ auditLog: { create: mocks.audit } }) }));

const merchantId = "cm12345678901234567890123";
const verifiedOrder = { orderId: 1234, status: "pending", currency: "USD", totalMinor: 12650, paymentRequired: true, privateAuthentication: "VERIFIED" };

function access(role: "OWNER" | "ADMIN") {
  return { session: { role, user: { id: `user_${role.toLowerCase()}` }, organization: { id: "org_1" } }, organization: { id: "org_1" }, merchant: { id: merchantId, organizationId: "org_1" } };
}

function request(body: unknown = { orderId: "1234" }) {
  return new Request(`https://orbit.example/api/sentinel/merchants/${merchantId}/relay/orders/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://orbit.example" },
    body: JSON.stringify(body),
  });
}

describe("WooCommerce Relay order verification route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValue(undefined);
    mocks.audit.mockResolvedValue({});
    mocks.verify.mockResolvedValue({ ...verifiedOrder });
  });

  it.each(["OWNER", "ADMIN"] as const)("allows %s to verify an order with only its ID from the browser", async (role) => {
    mocks.requireAccess.mockResolvedValueOnce(access(role));
    const { POST } = await import("@/app/api/sentinel/merchants/[merchantId]/relay/orders/verify/route");
    const response = await POST(request() as never, { params: Promise.resolve({ merchantId }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(mocks.requireAccess).toHaveBeenCalledWith(expect.any(Request), merchantId, { allowedRoles: ["OWNER", "ADMIN"], mutation: true });
    expect(mocks.verify).toHaveBeenCalledWith(merchantId, 1234);
    expect(await response.json()).toEqual({ order: verifiedOrder });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "WOO_RELAY_ORDER_VERIFIED", targetId: "1234" }) }));
  });

  it("does not accept amount, currency, or extra browser fields", async () => {
    mocks.requireAccess.mockResolvedValueOnce(access("OWNER"));
    const { POST } = await import("@/app/api/sentinel/merchants/[merchantId]/relay/orders/verify/route");
    const response = await POST(request({ orderId: "1234", currency: "EUR", amount: 1 }) as never, { params: Promise.resolve({ merchantId }) });
    expect(response.status).toBe(400);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("rejects malformed order IDs before calling WooCommerce", async () => {
    mocks.requireAccess.mockResolvedValueOnce(access("ADMIN"));
    const { POST } = await import("@/app/api/sentinel/merchants/[merchantId]/relay/orders/verify/route");
    const response = await POST(request({ orderId: "../../payment" }) as never, { params: Promise.resolve({ merchantId }) });
    expect(response.status).toBe(400);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it.each([403, 404])("does not call Relay when merchant access fails with %s", async (status) => {
    mocks.requireAccess.mockRejectedValueOnce(Object.assign(new Error(status === 403 ? "Forbidden" : "Merchant not found"), { status }));
    const { POST } = await import("@/app/api/sentinel/merchants/[merchantId]/relay/orders/verify/route");
    const response = await POST(request() as never, { params: Promise.resolve({ merchantId }) });
    expect(response.status).toBe(status);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("returns a safe normalized authentication error and audits only the code", async () => {
    mocks.requireAccess.mockResolvedValueOnce(access("OWNER"));
    mocks.verify.mockRejectedValueOnce(Object.assign(new Error("Private Relay authentication failed"), { status: 401, code: "INVALID_HMAC" }));
    const { POST } = await import("@/app/api/sentinel/merchants/[merchantId]/relay/orders/verify/route");
    const response = await POST(request() as never, { params: Promise.resolve({ merchantId }) });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Private Relay authentication failed", code: "INVALID_HMAC" });
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("signature");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "WOO_RELAY_ORDER_VERIFICATION_FAILED", metadata: { orderId: 1234, errorCode: "INVALID_HMAC" } }) }));
  });
});
