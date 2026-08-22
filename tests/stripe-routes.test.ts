import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  rateLimit: vi.fn(),
  connect: vi.fn(),
  onboarding: vi.fn(),
  sync: vi.fn(),
  auditError: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@/sentinel/http", () => ({
  requireMerchantAccess: mocks.requireAccess,
  apiError: (error: { status?: number; message?: string }) => Response.json({ error: error.message ?? "Unexpected server error" }, { status: error.status ?? 500 }),
}));
vi.mock("@/sentinel/rate-limit", () => ({ enforceRateLimit: mocks.rateLimit }));
vi.mock("@/sentinel/db", () => ({ getDatabase: () => ({ auditLog: { create: mocks.auditCreate } }) }));
vi.mock("@/stripe/service", () => ({
  connectStripeAccount: mocks.connect,
  createStripeOnboardingLink: mocks.onboarding,
  syncStripeConnectAccount: mocks.sync,
  auditStripeConnectError: mocks.auditError,
}));

const request = new Request("http://localhost/api/sentinel/merchants/merchant_1/stripe/connect", { method: "POST", headers: { origin: "http://localhost:3000" } });
const params = { params: Promise.resolve({ merchantId: "merchant_1" }) };
const integration = { id: "integration_1", stripeAccountId: "acct_orbit", displayStatus: "ONBOARDING" };

function session(role: "OWNER" | "ADMIN") {
  return { session: { role, user: { id: `user_${role.toLowerCase()}` }, organization: { id: "org_1" } }, merchant: { id: "merchant_1" }, organization: { id: "org_1" } };
}

describe("Stripe Connect mutation routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValue(undefined);
    mocks.auditError.mockResolvedValue(undefined);
    mocks.auditCreate.mockResolvedValue({});
  });

  it.each([
    ["unauthenticated", 401],
    ["merchant not found", 404],
    ["wrong organization", 404],
    ["VIEWER forbidden", 403],
  ])("rejects %s before creating a Stripe account", async (_case, status) => {
    mocks.requireAccess.mockRejectedValueOnce(Object.assign(new Error(String(_case)), { status }));
    const { POST } = await import("@/app/api/sentinel/merchants/[merchantId]/stripe/connect/route");
    const response = await POST(request as never, params);
    expect(response.status).toBe(status);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it.each(["OWNER", "ADMIN"] as const)("allows %s and requires OWNER/ADMIN plus mutation-origin validation", async (role) => {
    mocks.requireAccess.mockResolvedValueOnce(session(role));
    mocks.connect.mockResolvedValueOnce(integration);
    const { POST } = await import("@/app/api/sentinel/merchants/[merchantId]/stripe/connect/route");
    const response = await POST(request as never, params);
    expect(response.status).toBe(201);
    expect(mocks.requireAccess).toHaveBeenCalledWith(request, "merchant_1", { allowedRoles: ["OWNER", "ADMIN"], mutation: true });
    expect(mocks.connect).toHaveBeenCalledWith("merchant_1", `user_${role.toLowerCase()}`);
  });

  it("returns the same canonical acct_* when a duplicate connect click reaches the idempotent service", async () => {
    mocks.requireAccess.mockResolvedValue(session("OWNER"));
    mocks.connect.mockResolvedValue(integration);
    const { POST } = await import("@/app/api/sentinel/merchants/[merchantId]/stripe/connect/route");
    const first = await (await POST(request as never, params)).json();
    const second = await (await POST(request as never, params)).json();
    expect(first.integration.stripeAccountId).toBe("acct_orbit");
    expect(second.integration.stripeAccountId).toBe("acct_orbit");
  });

  it("returns a fresh server-generated Account Link", async () => {
    mocks.requireAccess.mockResolvedValueOnce(session("ADMIN"));
    mocks.onboarding.mockResolvedValueOnce({ url: "https://connect.stripe.test/setup/one-time" });
    const { POST } = await import("@/app/api/sentinel/merchants/[merchantId]/stripe/onboarding/route");
    const response = await POST(request as never, params);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://connect.stripe.test/setup/one-time" });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("performs an authoritative manual synchronization", async () => {
    mocks.requireAccess.mockResolvedValueOnce(session("OWNER"));
    mocks.sync.mockResolvedValueOnce({ ...integration, displayStatus: "IN_REVIEW" });
    const { POST } = await import("@/app/api/sentinel/merchants/[merchantId]/stripe/sync/route");
    const response = await POST(request as never, params);
    expect(response.status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith("merchant_1", { actorId: "user_owner" });
  });

  it("synchronizes after the onboarding return instead of treating return as approval", async () => {
    mocks.requireAccess.mockResolvedValueOnce(session("OWNER"));
    mocks.sync.mockResolvedValueOnce({ ...integration, displayStatus: "ACTION_REQUIRED" });
    const { GET } = await import("@/app/merchants/[merchantId]/integrations/stripe/return/route");
    const response = await GET(new Request("http://localhost/merchants/merchant_1/integrations/stripe/return") as never, params);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("stripeReturn=1");
    expect(mocks.sync).toHaveBeenCalledWith("merchant_1", { actorId: "user_owner", auditAction: "STRIPE_STATUS_SYNCED" });
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "STRIPE_ONBOARDING_RETURNED", metadata: { displayStatus: "ACTION_REQUIRED" } }) }));
  });

  it("replaces an expired Account Link with a newly generated link", async () => {
    mocks.requireAccess.mockResolvedValueOnce(session("ADMIN"));
    mocks.onboarding.mockResolvedValueOnce({ url: "https://connect.stripe.test/setup/replacement" });
    const { GET } = await import("@/app/merchants/[merchantId]/integrations/stripe/refresh/route");
    const response = await GET(new Request("http://localhost/merchants/merchant_1/integrations/stripe/refresh") as never, params);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://connect.stripe.test/setup/replacement");
    expect(mocks.onboarding).toHaveBeenCalledTimes(1);
  });
});
