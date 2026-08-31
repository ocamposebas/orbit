import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  rateLimit: vi.fn(),
  connect: vi.fn(),
  onboarding: vi.fn(),
  sync: vi.fn(),
  auditError: vi.fn(),
  auditCreate: vi.fn(),
  requestSession: vi.fn(),
}));

vi.mock("@/sentinel/http", () => ({
  requireMerchantAccess: mocks.requireAccess,
  HttpError: class extends Error { constructor(readonly status: number, message: string) { super(message); } },
  apiError: (error: { status?: number; message?: string }) => Response.json({ error: error.message ?? "Unexpected server error" }, { status: error.status ?? 500 }),
}));
vi.mock("@/sentinel/auth/session", () => ({ requestSession: mocks.requestSession }));
vi.mock("@/sentinel/config", () => ({ getServerEnv: () => ({ APP_URL: "https://orbit.example,https://alternate.example" }) }));
vi.mock("@/sentinel/rate-limit", () => ({ enforceRateLimit: mocks.rateLimit }));
vi.mock("@/sentinel/db", () => ({ getDatabase: () => ({ auditLog: { create: mocks.auditCreate } }) }));
vi.mock("@/stripe/service", () => ({
  connectStripeAccount: mocks.connect,
  createStripeOnboardingLink: mocks.onboarding,
  syncStripeConnectAccount: mocks.sync,
  auditStripeConnectError: mocks.auditError,
}));

const merchantId = "cm12345678901234567890123";
const request = new Request(`http://localhost/api/sentinel/merchants/${merchantId}/stripe/connect`, { method: "POST", headers: { origin: "http://localhost:3000" } });
const params = { params: Promise.resolve({ merchantId }) };
const integration = { id: "integration_1", stripeAccountId: "acct_orbit", displayStatus: "ONBOARDING" };

function session(role: "OWNER" | "ADMIN" | "REVIEWER" | "VIEWER") {
  return { session: { role, user: { id: `user_${role.toLowerCase()}` }, organization: { id: "org_1" } }, merchant: { id: merchantId }, organization: { id: "org_1" } };
}

describe("Stripe Connect mutation routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValue(undefined);
    mocks.auditError.mockResolvedValue(undefined);
    mocks.auditCreate.mockResolvedValue({});
    mocks.onboarding.mockResolvedValue({ url: "https://connect.stripe.test/setup/fresh" });
    mocks.requestSession.mockResolvedValue(session("OWNER").session);
  });

  it.each([
    ["unauthenticated", 401],
    ["merchant not found", 404],
    ["wrong organization", 404],
    ["unassigned client merchant", 404],
    ["workspace-wide analyst role", 403],
  ])("rejects %s before creating a Stripe account", async (_case, status) => {
    mocks.requireAccess.mockRejectedValueOnce(Object.assign(new Error(String(_case)), { status }));
    const { POST } = await import("@/app/api/sentinel/merchants/[merchantId]/stripe/connect/route");
    const response = await POST(request as never, params);
    expect(response.status).toBe(status);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it.each(["OWNER", "ADMIN", "REVIEWER", "VIEWER"] as const)("allows %s to start Stripe only after merchant-scope and mutation-origin validation", async (role) => {
    mocks.requireAccess.mockResolvedValueOnce(session(role));
    mocks.connect.mockResolvedValueOnce(integration);
    const { POST } = await import("@/app/api/sentinel/merchants/[merchantId]/stripe/connect/route");
    const response = await POST(request as never, params);
    expect(response.status).toBe(201);
    expect(mocks.requireAccess).toHaveBeenCalledWith(request, merchantId, { allowedRoles: ["OWNER", "ADMIN", "REVIEWER", "VIEWER"], mutation: true });
    expect(mocks.connect).toHaveBeenCalledWith(merchantId, `user_${role.toLowerCase()}`);
    expect(mocks.onboarding).toHaveBeenCalledWith(merchantId, `user_${role.toLowerCase()}`, "https://orbit.example");
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
    mocks.requireAccess.mockResolvedValueOnce(session("VIEWER"));
    mocks.onboarding.mockResolvedValueOnce({ url: "https://connect.stripe.test/setup/one-time" });
    const { POST } = await import("@/app/api/sentinel/merchants/[merchantId]/stripe/onboarding/route");
    const response = await POST(request as never, params);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://connect.stripe.test/setup/one-time" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.requireAccess).toHaveBeenCalledWith(request, merchantId, { allowedRoles: ["OWNER", "ADMIN", "REVIEWER", "VIEWER"], mutation: true });
  });

  it("keeps a Stripe Account Link callback on the allowed alternate origin", async () => {
    mocks.requireAccess.mockResolvedValueOnce(session("OWNER"));
    const alternateRequest = new Request(`https://alternate.example/api/sentinel/merchants/${merchantId}/stripe/onboarding`, {
      method: "POST",
      headers: { origin: "https://alternate.example" },
    });
    const { POST } = await import("@/app/api/sentinel/merchants/[merchantId]/stripe/onboarding/route");
    const response = await POST(alternateRequest as never, params);
    expect(response.status).toBe(200);
    expect(mocks.onboarding).toHaveBeenCalledWith(merchantId, "user_owner", "https://alternate.example");
  });

  it("performs an authoritative manual synchronization", async () => {
    mocks.requireAccess.mockResolvedValueOnce(session("REVIEWER"));
    mocks.sync.mockResolvedValueOnce({ ...integration, displayStatus: "IN_REVIEW" });
    const { POST } = await import("@/app/api/sentinel/merchants/[merchantId]/stripe/sync/route");
    const response = await POST(request as never, params);
    expect(response.status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith(merchantId, { actorId: "user_reviewer" });
  });

  it("synchronizes after the onboarding return instead of treating return as approval", async () => {
    mocks.requireAccess.mockResolvedValueOnce(session("OWNER"));
    mocks.sync.mockResolvedValueOnce({ ...integration, displayStatus: "ACTION_REQUIRED" });
    const { GET } = await import("@/app/merchants/[merchantId]/integrations/stripe/return/route");
    const response = await GET(new Request(`http://localhost/merchants/${merchantId}/integrations/stripe/return`) as never, params);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`https://orbit.example/sentinel/merchant/${merchantId}?stripeReturn=1#stripe-connect`);
    expect(mocks.sync).toHaveBeenCalledWith(merchantId, { actorId: "user_owner", auditAction: "STRIPE_STATUS_SYNCED" });
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "STRIPE_ONBOARDING_RETURNED", metadata: { displayStatus: "ACTION_REQUIRED" } }) }));
  });

  it("redirects an alternate-domain Stripe return back to that domain", async () => {
    mocks.requireAccess.mockResolvedValueOnce(session("OWNER"));
    mocks.sync.mockResolvedValueOnce({ ...integration, displayStatus: "ACTION_REQUIRED" });
    const { GET } = await import("@/app/merchants/[merchantId]/integrations/stripe/return/route");
    const response = await GET(new Request(`https://alternate.example/merchants/${merchantId}/integrations/stripe/return`) as never, params);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`https://alternate.example/sentinel/merchant/${merchantId}?stripeReturn=1#stripe-connect`);
  });

  it("sends an unauthenticated return through login with the merchant integration as its continuation", async () => {
    mocks.requestSession.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/merchants/[merchantId]/integrations/stripe/return/route");
    const response = await GET(new Request(`http://localhost/merchants/${merchantId}/integrations/stripe/return`) as never, params);
    const location = new URL(response.headers.get("location")!);
    expect(response.status).toBe(303);
    expect(location.origin).toBe("https://orbit.example");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(`/sentinel/merchant/${merchantId}?stripeReturn=login#stripe-connect`);
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("does not honor an open-redirect parameter on an unauthenticated Stripe return", async () => {
    mocks.requestSession.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/merchants/[merchantId]/integrations/stripe/return/route");
    const response = await GET(new Request(`http://localhost/merchants/${merchantId}/integrations/stripe/return?next=https://evil.example`) as never, params);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://orbit.example");
    expect(location.searchParams.get("next")).toBe(`/sentinel/merchant/${merchantId}?stripeReturn=login#stripe-connect`);
    expect(response.headers.get("location")).not.toContain("evil.example");
  });

  it("does not expose an unauthorized merchant from the return route", async () => {
    mocks.requireAccess.mockRejectedValueOnce(Object.assign(new Error("Merchant not found"), { status: 404 }));
    const { GET } = await import("@/app/merchants/[merchantId]/integrations/stripe/return/route");
    const response = await GET(new Request(`http://localhost/merchants/${merchantId}/integrations/stripe/return`) as never, params);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://orbit.example/sentinel?stripeReturn=unauthorized");
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("uses a safe dashboard fallback when Stripe synchronization fails", async () => {
    mocks.requireAccess.mockResolvedValueOnce(session("OWNER"));
    mocks.sync.mockRejectedValueOnce(new Error("Stripe unavailable"));
    const { GET } = await import("@/app/merchants/[merchantId]/integrations/stripe/return/route");
    const response = await GET(new Request(`http://localhost/merchants/${merchantId}/integrations/stripe/return`) as never, params);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`https://orbit.example/sentinel/merchant/${merchantId}?stripeReturn=error#stripe-connect`);
    expect(mocks.auditError).toHaveBeenCalledWith(merchantId, "user_owner", "return", expect.any(Error));
  });

  it("rejects an invalid merchantId before authentication or database access", async () => {
    const { GET } = await import("@/app/merchants/[merchantId]/integrations/stripe/return/route");
    const response = await GET(new Request("http://localhost/merchants/not-a-cuid/integrations/stripe/return") as never, { params: Promise.resolve({ merchantId: "not-a-cuid" }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid merchant return request" });
    expect(mocks.requestSession).not.toHaveBeenCalled();
    expect(mocks.requireAccess).not.toHaveBeenCalled();
  });

  it("replaces an expired Account Link with a newly generated link", async () => {
    mocks.requireAccess.mockResolvedValueOnce(session("VIEWER"));
    mocks.onboarding.mockResolvedValueOnce({ url: "https://connect.stripe.test/setup/replacement" });
    const { GET } = await import("@/app/merchants/[merchantId]/integrations/stripe/refresh/route");
    const response = await GET(new Request(`http://localhost/merchants/${merchantId}/integrations/stripe/refresh`) as never, params);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://connect.stripe.test/setup/replacement");
    expect(mocks.onboarding).toHaveBeenCalledTimes(1);
    expect(mocks.requireAccess).toHaveBeenCalledWith(expect.anything(), merchantId, { allowedRoles: ["OWNER", "ADMIN", "REVIEWER", "VIEWER"] });
  });

  it("sends an unauthenticated refresh through login and resumes with a new Account Link", async () => {
    mocks.requestSession.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/merchants/[merchantId]/integrations/stripe/refresh/route");
    const response = await GET(new Request(`http://localhost/merchants/${merchantId}/integrations/stripe/refresh`) as never, params);
    const location = new URL(response.headers.get("location")!);
    expect(response.status).toBe(303);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(`/merchants/${merchantId}/integrations/stripe/refresh`);
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    expect(mocks.onboarding).not.toHaveBeenCalled();
  });
});
