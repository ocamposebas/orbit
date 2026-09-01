import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rateLimit: vi.fn(),
  merchant: vi.fn(),
  audit: vi.fn(),
  balance: vi.fn(),
  retrieveSettings: vi.fn(),
  updateSettings: vi.fn(),
  createPayout: vi.fn(),
}));

vi.mock("@/sentinel/auth/session", () => ({ requestSession: mocks.session }));
vi.mock("@/sentinel/rate-limit", () => ({ enforceRateLimit: mocks.rateLimit }));
vi.mock("@/sentinel/db", () => ({ getDatabase: () => ({ merchant: { findFirst: mocks.merchant }, auditLog: { create: mocks.audit } }) }));
vi.mock("@/stripe/client", () => ({ getStripeClient: () => ({ balance: { retrieve: mocks.balance }, balanceSettings: { retrieve: mocks.retrieveSettings, update: mocks.updateSettings }, payouts: { create: mocks.createPayout } }) }));
vi.mock("@/sentinel/http", () => ({
  HttpError: class extends Error { constructor(readonly status: number, message: string) { super(message); } },
  portalMerchantScope: (session: { organization: { id: string } }) => ({ organizationId: session.organization.id }),
  validateMutationOrigin: vi.fn(),
  apiError: (error: { status?: number; message?: string }) => Response.json({ error: error.message ?? "Unexpected server error" }, { status: error.status ?? 500 }),
}));

const merchant = {
  id: "merchant_1", organizationId: "org_1", businessName: "RGV Prime", portalEnabled: true,
  agreement: { status: "SIGNED_LOCKED" },
  stripeConnect: { stripeAccountId: "acct_1", displayStatus: "ENABLED", cardPaymentsStatus: "active", payoutsStatus: "active" },
  accessGrants: [{ canInitiatePayouts: true }],
};

function request(amountMinor = 2500) {
  return new Request("https://orbit.example/api/portal/payouts", {
    method: "POST", headers: { origin: "https://orbit.example", "content-type": "application/json" },
    body: JSON.stringify({ merchantId: merchant.id, amountMinor, currency: "USD", idempotencyKey: "00000000-0000-4000-8000-000000000001" }),
  });
}

describe("ORBIT Payment transfer route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ role: "VIEWER", user: { id: "user_1" }, organization: { id: "org_1" } });
    mocks.merchant.mockResolvedValue(merchant);
    mocks.balance.mockResolvedValue({ available: [{ amount: 10_000, currency: "usd" }] });
    mocks.retrieveSettings.mockResolvedValue({ payments: { payouts: { schedule: { interval: "manual" } } } });
    mocks.updateSettings.mockResolvedValue({ payments: { payouts: { schedule: { interval: "manual" } } } });
    mocks.createPayout.mockResolvedValue({ id: "po_orbit", amount: 2500, currency: "usd", status: "pending", arrival_date: 1_800_000_000, method: "standard" });
    mocks.audit.mockResolvedValue({});
  });

  it("creates a standard bank transfer with connected-account context and an idempotency key", async () => {
    const { POST } = await import("@/app/api/portal/payouts/route");
    const response = await POST(request() as never);
    expect(response.status).toBe(201);
    expect(mocks.createPayout).toHaveBeenCalledWith(expect.objectContaining({ amount: 2500, currency: "usd", method: "standard" }), expect.objectContaining({ stripeContext: "acct_1", idempotencyKey: expect.stringContaining("00000000-0000-4000-8000-000000000001") }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "orbit_payment.transfer_created", targetId: "po_orbit" }) }));
  });

  it("keeps users read-only until an administrator enables transfers for the brand", async () => {
    mocks.merchant.mockResolvedValue({ ...merchant, accessGrants: [{ canInitiatePayouts: false }] });
    const { POST } = await import("@/app/api/portal/payouts/route");
    const response = await POST(request() as never);
    expect(response.status).toBe(403);
    expect(mocks.createPayout).not.toHaveBeenCalled();
  });

  it("rejects an amount above the authoritative available balance", async () => {
    const { POST } = await import("@/app/api/portal/payouts/route");
    const response = await POST(request(10_001) as never);
    expect(response.status).toBe(409);
    expect(mocks.createPayout).not.toHaveBeenCalled();
  });

  it("allows workspace owners without an explicit per-brand grant", async () => {
    mocks.session.mockResolvedValue({ role: "OWNER", user: { id: "owner_1" }, organization: { id: "org_1" } });
    mocks.merchant.mockResolvedValue({ ...merchant, accessGrants: [] });
    const { POST } = await import("@/app/api/portal/payouts/route");
    const response = await POST(request() as never);
    expect(response.status).toBe(201);
  });

  it("requires explicit on-demand mode before creating a transfer", async () => {
    mocks.retrieveSettings.mockResolvedValue({ payments: { payouts: { schedule: { interval: "daily" } } } });
    const { POST } = await import("@/app/api/portal/payouts/route");
    const response = await POST(request() as never);
    expect(response.status).toBe(409);
    expect(mocks.createPayout).not.toHaveBeenCalled();
  });

  it("returns the successful transfer even if secondary audit logging is temporarily unavailable", async () => {
    mocks.audit.mockRejectedValueOnce(new Error("database unavailable"));
    const { POST } = await import("@/app/api/portal/payouts/route");
    const response = await POST(request() as never);
    expect(response.status).toBe(201);
    expect((await response.json()).transfer.id).toBe("po_orbit");
  });

  it("lets an owner explicitly switch the brand to on-demand transfers", async () => {
    mocks.session.mockResolvedValue({ role: "OWNER", user: { id: "owner_1" }, organization: { id: "org_1" } });
    const { PATCH } = await import("@/app/api/portal/payouts/route");
    const response = await PATCH(new Request("https://orbit.example/api/portal/payouts", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ merchantId: merchant.id }) }) as never);
    expect(response.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ payments: { payouts: { schedule: { interval: "manual" } } } }), { stripeContext: "acct_1" });
  });
});
