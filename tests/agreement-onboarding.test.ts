import { describe, expect, it } from "vitest";
import { agreementDocumentHtml, FIRST_MONTH_ACTIVATION_FEE_USD, MONTHLY_SERVICE_FEE_USD, PLATFORM_SERVICE_FEE_PERCENT, safeContractFilename, sha256, STANDARD_STRIPE_PROCESSING_FEE_PERCENT, TOTAL_TRANSFER_FEE_PERCENT } from "@/contracts/document";
import { AGREEMENT_TERMS_VERSION, agreementAdminState, createInvitationCredentials, hashInvitationToken, publicAgreementState } from "@/contracts/service";
import { merchantAgreementIntakeSchema, SIGNED_CONTRACT_MAX_BYTES } from "@/contracts/schema";

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
  countryCode: "us",
  coveredDomains: "https://northstar.example",
  primaryContactName: "Alex Merchant",
  primaryContactRole: "CEO",
  primaryContactEmail: "ALEX@NORTHSTAR.EXAMPLE",
  primaryContactPhone: "+1 305 555 0100",
  billingDescriptor: "NORTHSTAR",
  estimatedMonthlyVolume: "USD 50,000",
  averageTransactionAmount: "USD 75",
  highestTransactionAmount: "USD 500",
  productsAndServices: "Research products sold online.",
  certifyAuthority: true,
  certifyAccuracy: true,
  acceptElectronicProcess: true,
} as const;

describe("contractual onboarding", () => {
  it("creates high-entropy invitations and stores only a stable hash", () => {
    const first = createInvitationCredentials(new Date("2026-08-24T00:00:00Z"));
    const second = createInvitationCredentials(new Date("2026-08-24T00:00:00Z"));
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toBe(hashInvitationToken(first.token));
    expect(first.expiresAt.toISOString()).toBe("2026-09-23T00:00:00.000Z");
  });

  it("distinguishes an optional legacy agreement from an invitation that was actually sent", () => {
    const base = { status: "INVITED", invitationExpiresAt: new Date("2026-09-23T00:00:00Z"), informationCertifiedAt: null, contractIssuedAt: null, signedUploadedAt: null, signedOriginalName: null, signedSizeBytes: null, lockedAt: null, termsVersion: "orbit-msa-en-1.0" };
    expect(agreementAdminState({ ...base, invitationIssuedAt: null })).toMatchObject({ status: "INVITED", workflow: "OPTIONAL", invitationIssuedAt: null });
    expect(agreementAdminState({ ...base, invitationIssuedAt: new Date("2026-08-24T00:00:00Z") })).toMatchObject({ workflow: "AWAITING_CUSTOMER", invitationIssuedAt: new Date("2026-08-24T00:00:00Z") });
  });

  it("prefills existing merchants without inventing signer or tax details", () => {
    const state = publicAgreementState({
      status: "INVITED",
      selfServe: false,
      invitationExpiresAt: new Date("2026-09-23T00:00:00Z"),
      termsVersion: AGREEMENT_TERMS_VERSION,
      legalName: null,
      tradeName: null,
      entityType: null,
      taxId: null,
      registrationNumber: null,
      businessAddress: null,
      city: null,
      region: null,
      postalCode: null,
      countryCode: null,
      coveredDomains: null,
      primaryContactName: null,
      primaryContactRole: null,
      primaryContactEmail: null,
      primaryContactPhone: null,
      billingDescriptor: null,
      estimatedMonthlyVolume: null,
      averageTransactionAmount: null,
      highestTransactionAmount: null,
      productsAndServices: null,
      signedUploadedAt: null,
      signedOriginalName: null,
      merchant: {
        businessName: "RGVPRIME LLC",
        industry: "Research products",
        country: "US",
        legalCountry: "US",
        businessDescription: "Research products sold through the merchant website.",
        expectedMonthlyVolume: "USD 50,000",
        sites: [{ normalizedUrl: "https://rgvprimellc.com", hostname: "rgvprimellc.com" }],
      },
    } as never);
    expect(state.intake).toMatchObject({
      businessName: "RGVPRIME LLC",
      legalName: "RGVPRIME LLC",
      publicWebsite: "https://rgvprimellc.com",
      countryCode: "US",
      estimatedMonthlyVolume: "USD 50,000",
    });
    expect(state.intake?.primaryContactName).toBe("");
    expect(state.intake?.taxId).toBe("");
  });

  it("normalizes certified intake and requires every irreversible consent", () => {
    const parsed = merchantAgreementIntakeSchema.parse(intake);
    expect(parsed.countryCode).toBe("US");
    expect(parsed.primaryContactEmail).toBe("alex@northstar.example");
    expect(parsed.businessName).toBe("Northstar Research");
    expect(() => merchantAgreementIntakeSchema.parse({ ...intake, certifyAuthority: false })).toThrow();
  });

  it("renders a tailored agreement with the requested representative", () => {
    const parsed = merchantAgreementIntakeSchema.parse(intake);
    const html = agreementDocumentHtml({
      id: "cm1234567890",
      termsVersion: AGREEMENT_TERMS_VERSION,
      ...parsed,
      tradeName: parsed.tradeName ?? null,
      registrationNumber: parsed.registrationNumber ?? null,
      informationCertifiedAt: new Date("2026-08-24T00:00:00Z"),
      merchant: { businessName: "Northstar", industry: "Research" },
    });
    expect(html).toContain("Sebastian Ocampo");
    expect(html).toContain("Northstar Research LLC");
    expect(html).toContain("does not perform KYC/KYB");
    expect(html).toContain("are not certifications");
    expect(html).toContain("USD $1100.00");
    expect(html).toContain("USD $350.00 per month");
    expect(html).toContain("Beginning with the second monthly billing period");
    expect(html).toContain("immediately correct any website, product, content, policy, checkout flow or business practice");
    expect(html).toContain("ORBIT's written standards");
    expect(html).toContain("5.9% of Gross Transaction Value");
    expect(html).toContain("3.0% ORBIT Platform Service Fee");
    expect(html).toContain("2.9% standard Stripe processing fee");
    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain('lang="en"');
    expect(FIRST_MONTH_ACTIVATION_FEE_USD).toBe(1100);
    expect(MONTHLY_SERVICE_FEE_USD).toBe(350);
    expect(PLATFORM_SERVICE_FEE_PERCENT).toBe(3);
    expect(STANDARD_STRIPE_PROCESSING_FEE_PERCENT).toBe(2.9);
    expect(TOTAL_TRANSFER_FEE_PERCENT).toBe(5.9);
  });

  it("provides deterministic integrity helpers and safe filenames", () => {
    expect(sha256(new TextEncoder().encode("contract"))).toHaveLength(64);
    expect(safeContractFilename("Compañía / Uno S.A.S.")).toBe("compania-uno-s-a-s");
    expect(SIGNED_CONTRACT_MAX_BYTES).toBe(15 * 1024 * 1024);
  });
});
