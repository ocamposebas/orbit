import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), merchantFind: vi.fn(), rateLimit: vi.fn() }));
vi.mock("@/sentinel/auth/session", () => ({ requestSession: mocks.session }));
vi.mock("@/sentinel/db", () => ({ getDatabase: () => ({ merchant: { findFirst: mocks.merchantFind } }) }));
vi.mock("@/sentinel/rate-limit", () => ({ enforceRateLimit: mocks.rateLimit }));

describe("Payment Link permission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ role: "VIEWER", portalAllMerchants: false, user: { id: "user_client" }, organization: { id: "org_1" } });
    mocks.merchantFind.mockResolvedValue({
      id: "merchant_1", organizationId: "org_1", businessName: "Client One", portalEnabled: true, platformFeeBps: 300,
      stripeConnect: { stripeEnvironment: "TEST", cardPaymentsStatus: "active" }, accessGrants: [{ canCreatePaymentLinks: false }],
    });
  });

  it("does not create a link until an administrator enables the one-time capability", async () => {
    const { POST } = await import("@/app/api/portal/payment-links/route");
    const response = await POST(new Request("https://orbit.example/api/portal/payment-links", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ merchantId: "merchant_1", title: "Invoice 104", description: null, amountMinor: 10000, currency: "USD", expiresAt: null }) }) as never);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "Payment Links access has not been enabled. Contact your ORBIT administrator." });
  });
});
