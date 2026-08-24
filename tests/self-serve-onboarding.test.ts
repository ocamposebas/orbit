import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agreementFromInvitation: vi.fn(),
  publicAgreementState: vi.fn(),
  createInvitation: vi.fn(),
  requireRole: vi.fn(),
  validateOrigin: vi.fn(),
  rateLimit: vi.fn(),
  agreementUpdateMany: vi.fn(),
  merchantUpdate: vi.fn(),
  siteUpsert: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/contracts/service", () => ({
  INVITATION_VALIDITY_DAYS: 30,
  agreementFromInvitation: mocks.agreementFromInvitation,
  publicAgreementState: mocks.publicAgreementState,
  agreementAdminState: (value: unknown) => value,
  invitationUrl: (token: string) => `https://orbit.example/onboarding/${token}`,
}));
vi.mock("@/sentinel/services/merchants", () => ({ createSelfServeMerchantInvitation: mocks.createInvitation }));
vi.mock("@/sentinel/auth/session", () => ({ requestSession: vi.fn() }));
vi.mock("@/sentinel/rate-limit", () => ({ enforceRateLimit: mocks.rateLimit }));
vi.mock("@/sentinel/http", () => {
  class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
  return {
    HttpError,
    merchantScope: vi.fn(),
    requireRole: mocks.requireRole,
    validateMutationOrigin: mocks.validateOrigin,
    apiError: (error: { status?: number; message?: string }) => Response.json({ error: error.message ?? "Unexpected server error" }, { status: error.status ?? 500 }),
  };
});
vi.mock("@/sentinel/db", () => ({ getDatabase: () => ({
  merchant: { findMany: vi.fn() },
  $transaction: mocks.transaction,
}) }));

const intake = {
  businessName: "Northstar Research",
  publicWebsite: "https://northstar.example",
  industry: "Research products",
  operatingCountry: "United States",
  businessDescription: "Online research-products merchant serving laboratory customers.",
  legalName: "Northstar Research LLC",
  tradeName: "Northstar",
  entityType: "LLC",
  taxId: "12-3456789",
  registrationNumber: "REG-123",
  businessAddress: "100 Market Street",
  city: "Miami",
  region: "Florida",
  postalCode: "33101",
  countryCode: "US",
  coveredDomains: "https://northstar.example",
  primaryContactName: "Alex Merchant",
  primaryContactRole: "CEO",
  primaryContactEmail: "alex@northstar.example",
  primaryContactPhone: "+1 305 555 0100",
  billingDescriptor: "NORTHSTAR",
  estimatedMonthlyVolume: "USD 50,000",
  averageTransactionAmount: "USD 75",
  highestTransactionAmount: "USD 500",
  productsAndServices: "Research products sold online.",
  certifyAuthority: true,
  certifyAccuracy: true,
  acceptElectronicProcess: true,
};

describe("self-serve merchant invitations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValue(undefined);
    mocks.requireRole.mockResolvedValue({ id: "org_1" });
    mocks.createInvitation.mockResolvedValue({ merchant: { id: "merchant_pending" }, invitationToken: "token", invitationExpiresAt: new Date("2026-09-23T00:00:00Z") });
    mocks.agreementUpdateMany.mockResolvedValue({ count: 1 });
    mocks.merchantUpdate.mockResolvedValue({});
    mocks.siteUpsert.mockResolvedValue({});
    mocks.auditCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      merchantAgreement: { updateMany: mocks.agreementUpdateMany },
      merchant: { update: mocks.merchantUpdate },
      merchantSite: { upsert: mocks.siteUpsert },
      auditLog: { create: mocks.auditCreate },
    }));
  });

  it("creates a private invitation without requiring an admin request body", async () => {
    const { POST } = await import("@/app/api/sentinel/merchants/route");
    const request = new Request("https://orbit.example/api/sentinel/merchants", { method: "POST" });
    const response = await POST(request as never);
    expect(response.status).toBe(201);
    expect(mocks.createInvitation).toHaveBeenCalledWith("org_1");
    expect(await response.json()).toMatchObject({ merchant: { id: "merchant_pending" }, invitationUrl: "https://orbit.example/onboarding/token" });
  });

  it("lets the invitee atomically create the real merchant profile and primary site", async () => {
    const invited = { id: "agreement_1", merchantId: "merchant_pending", status: "INVITED", selfServe: true, termsVersion: "orbit-msa-es-1.0", merchant: { organizationId: "org_1" } };
    mocks.agreementFromInvitation.mockResolvedValue(invited);
    mocks.publicAgreementState.mockReturnValue({ status: "DATA_COMPLETED" });
    const { POST } = await import("@/app/api/onboarding/[token]/route");
    const request = new Request("https://orbit.example/api/onboarding/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(intake) });
    const response = await POST(request as never, { params: Promise.resolve({ token: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }) });
    expect(response.status).toBe(200);
    expect(mocks.merchantUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "merchant_pending" }, data: expect.objectContaining({ businessName: "Northstar Research", industry: "Research products", country: "United States" }) }));
    expect(mocks.siteUpsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ normalizedUrl: "https://northstar.example/", hostname: "northstar.example" }) }));
    expect(mocks.agreementUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "agreement_1", status: "INVITED" }, data: expect.objectContaining({ status: "DATA_COMPLETED" }) }));
  });
});
