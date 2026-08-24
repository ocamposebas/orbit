import { describe, expect, it } from "vitest";
import { agreementDocumentHtml, safeContractFilename, sha256 } from "@/contracts/document";
import { createInvitationCredentials, hashInvitationToken } from "@/contracts/service";
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
      termsVersion: "orbit-msa-es-1.0",
      ...parsed,
      tradeName: parsed.tradeName ?? null,
      registrationNumber: parsed.registrationNumber ?? null,
      informationCertifiedAt: new Date("2026-08-24T00:00:00Z"),
      merchant: { businessName: "Northstar", industry: "Research" },
    });
    expect(html).toContain("Sebastian Ocampo");
    expect(html).toContain("Northstar Research LLC");
    expect(html).toContain("no realiza KYC/KYB");
    expect(html).toContain("no son certificaciones");
  });

  it("provides deterministic integrity helpers and safe filenames", () => {
    expect(sha256(new TextEncoder().encode("contract"))).toHaveLength(64);
    expect(safeContractFilename("Compañía / Uno S.A.S.")).toBe("compania-uno-s-a-s");
    expect(SIGNED_CONTRACT_MAX_BYTES).toBe(15 * 1024 * 1024);
  });
});
