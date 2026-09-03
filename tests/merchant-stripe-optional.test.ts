import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ merchantFind: vi.fn(), stripeFind: vi.fn(), relayFind: vi.fn(), installationFindMany: vi.fn(), evidenceFindMany: vi.fn(), warn: vi.fn() }));

vi.mock("@/sentinel/db", () => ({ getDatabase: () => ({ merchant: { findFirst: mocks.merchantFind }, aiEvidence: { findMany: mocks.evidenceFindMany }, stripeConnectIntegration: { findUnique: mocks.stripeFind }, wooCommerceRelayIntegration: { findUnique: mocks.relayFind }, wooCommerceInstallation: { findMany: mocks.installationFindMany } }) }));
vi.mock("@/sentinel/logger", () => ({ childLogger: () => ({ warn: mocks.warn }) }));
vi.mock("@/sentinel/http", () => {
  class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
  return {
    HttpError,
    requireMerchantAccess: vi.fn().mockResolvedValue({ organization: { id: "org_1" } }),
    apiError: (error: { status?: number }) => Response.json({ error: "Unexpected server error" }, { status: error.status ?? 500 }),
  };
});

describe("optional Stripe schema on the merchant dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.merchantFind.mockResolvedValue({ id: "merchant_1", organizationId: "org_1", businessName: "Merchant" });
    mocks.stripeFind.mockResolvedValue(null);
    mocks.relayFind.mockResolvedValue(null);
    mocks.installationFindMany.mockResolvedValue([]);
    mocks.evidenceFindMany.mockResolvedValue([]);
  });

  it.each(["P2021", "P2022"])("keeps Sentinel available when Prisma reports %s for the Relay table", async (code) => {
    mocks.relayFind.mockRejectedValueOnce(Object.assign(new Error("optional Relay schema missing"), { code }));
    const { GET } = await import("@/app/api/sentinel/merchants/[merchantId]/route");
    const response = await GET(new Request("http://localhost/api/sentinel/merchants/merchant_1") as never, { params: Promise.resolve({ merchantId: "merchant_1" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ merchant: { id: "merchant_1", wooCommerceRelay: null, wooCommerceRelayAvailable: false } });
    expect(mocks.warn).toHaveBeenCalledWith(expect.objectContaining({ merchantId: "merchant_1", errorCode: code }), expect.any(String));
  });

  it.each(["P2021", "P2022"])("keeps Sentinel available when Prisma reports %s for the Stripe tables", async (code) => {
    mocks.stripeFind.mockRejectedValueOnce(Object.assign(new Error("optional Stripe schema missing"), { code }));
    const { GET } = await import("@/app/api/sentinel/merchants/[merchantId]/route");
    const response = await GET(new Request("http://localhost/api/sentinel/merchants/merchant_1") as never, { params: Promise.resolve({ merchantId: "merchant_1" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ merchant: { id: "merchant_1", stripeConnect: null, stripeConnectAvailable: false } });
    expect(mocks.warn).toHaveBeenCalledWith(expect.objectContaining({ merchantId: "merchant_1", errorCode: code }), expect.any(String));
  });

  it("does not hide unrelated database or programming failures", async () => {
    mocks.stripeFind.mockRejectedValueOnce(new Error("unexpected query failure"));
    const { GET } = await import("@/app/api/sentinel/merchants/[merchantId]/route");
    const response = await GET(new Request("http://localhost/api/sentinel/merchants/merchant_1") as never, { params: Promise.resolve({ merchantId: "merchant_1" }) });
    expect(response.status).toBe(500);
  });

  it("returns findings only from the latest assessment", async () => {
    const finding = (id: string, scanId: string) => ({
      id,
      scanId,
      title: id,
      explanation: `${id} explanation`,
      remediation: `${id} remediation`,
      affectedUrl: "https://merchant.example/",
      createdAt: new Date("2026-09-03T12:00:00Z"),
      evidence: [],
    });
    mocks.merchantFind.mockResolvedValueOnce({
      id: "merchant_1",
      organizationId: "org_1",
      businessName: "Merchant",
      aiScans: [
        { id: "scan-new", status: "COMPLETED", score: 91, scoreBreakdown: {}, coverage: {}, createdAt: new Date("2026-09-03T12:00:00Z"), products: [], _count: { findings: 1 } },
        { id: "scan-old", status: "COMPLETED", score: 34, scoreBreakdown: {}, coverage: {}, createdAt: new Date("2026-09-01T12:00:00Z"), products: [], _count: { findings: 1 } },
      ],
      aiFindings: [finding("Current issue", "scan-new"), finding("Already fixed issue", "scan-old")],
      auditLogs: [],
    });

    const { GET } = await import("@/app/api/sentinel/merchants/[merchantId]/route");
    const response = await GET(new Request("http://localhost/api/sentinel/merchants/merchant_1") as never, { params: Promise.resolve({ merchantId: "merchant_1" }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.merchant.findings).toHaveLength(1);
    expect(body.merchant.findings[0]).toMatchObject({ id: "Current issue", scanId: "scan-new" });
  });
});
