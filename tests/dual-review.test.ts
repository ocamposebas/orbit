import { describe, expect, it } from "vitest";
import { isScorableCandidate } from "@/sentinel/analysis/candidate-quality";
import { evidenceManifestSchema, type EvidenceManifest } from "@/sentinel/evidence/schema";
import { attachRetainedCandidateEvidence, candidateDomain, lunaObservationCandidate } from "@/sentinel/review/adjudication";
import { lunaMerchantReviewSchema, type LunaObservation } from "@/sentinel/review/schema";
import type { CandidateFinding } from "@/sentinel/types";
import { verifyEvidenceManifest } from "@/sentinel/verification/verifier";

function record(input: Partial<EvidenceManifest["records"][number]> & Pick<EvidenceManifest["records"][number], "id" | "artifactId" | "sourceUrl" | "evidenceType">): EvidenceManifest["records"][number] {
  return {
    scope: "MERCHANT_SITE",
    artifactKind: "PAGE_SNAPSHOT",
    sourceHash: `record-${input.id}`,
    artifactHash: `artifact-${input.artifactId}`,
    ...input,
  };
}

const manifest = evidenceManifestSchema.parse({
  version: "orbit-evidence-manifest-v1",
  scanId: "scan-1",
  generatedAt: new Date().toISOString(),
  records: [
    record({ id: "home-type", artifactId: "home", sourceUrl: "https://merchant.test/", evidenceType: "PAGE_TYPE", value: "HOME", httpStatus: 200, artifactHash: "same-page" }),
    record({ id: "home-text", artifactId: "home", sourceUrl: "https://merchant.test/", evidenceType: "VISIBLE_TEXT", exactText: "Research products", httpStatus: 200, artifactHash: "same-page" }),
    record({ id: "copy-type", artifactId: "copy", sourceUrl: "https://merchant.test/copy", evidenceType: "PAGE_TYPE", value: "OTHER", httpStatus: 200, artifactHash: "same-page" }),
    record({ id: "product-type", artifactId: "product", sourceUrl: "https://merchant.test/products/a", evidenceType: "PAGE_TYPE", value: "PRODUCT", httpStatus: 200 }),
    record({ id: "claim", artifactId: "product", sourceUrl: "https://merchant.test/products/a", evidenceType: "CLAIM", exactText: "Treats disease in people", httpStatus: 200 }),
    record({ id: "privacy-type", artifactId: "privacy", sourceUrl: "https://merchant.test/privacy", evidenceType: "PAGE_TYPE", value: "PRIVACY", httpStatus: 200 }),
    record({ id: "schema", artifactId: "product", sourceUrl: "https://merchant.test/products/a", evidenceType: "STRUCTURED_DATA", value: { "@type": "Product" }, httpStatus: 200 }),
  ],
});

function candidate(overrides: Partial<CandidateFinding> = {}): CandidateFinding {
  return { ruleKey: "MKT-MEDICAL-001", severity: "HIGH", confidence: 0.95, status: "NEEDS_REVIEW", category: "Medical claim", title: "Medical claim", description: "Description", url: "https://merchant.test/products/a", pageType: "PRODUCT", detectedText: "Treats disease in people", reason: "Exact claim", recommendedAction: "Review", scoreComponent: "MARKETING_RISK", ...overrides };
}

describe("dual-review evidence contracts", () => {
  it("independently verifies objective facts and exact duplicate artifacts", () => {
    const facts = verifyEvidenceManifest(manifest);
    expect(facts.find((item) => item.factType === "PRODUCT_COUNT")?.value).toEqual({ count: 1 });
    expect(facts.find((item) => item.issueKey === "fact:policy-presence:PRIVACY")?.state).toBe("VERIFIED");
    expect(facts.find((item) => item.issueKey === "fact:policy-presence:TERMS")?.state).toBe("REFUTED");
    expect(facts.find((item) => item.factType === "STRUCTURED_DATA_COUNT")?.value).toEqual({ count: 1 });
    expect(facts.find((item) => item.factType === "EXACT_DUPLICATE_CONTENT")?.value).toMatchObject({ count: 2 });
  });

  it("projects Luna conclusions only from retained first-party evidence", () => {
    const observation: LunaObservation = { issueKey: "medical-claim", domain: "SEMANTIC_CONTEXT", category: "Claims", riskTheme: "MEDICAL_DISEASE", classification: "ADVERSE", conclusion: "The product-facing statement presents a treatment claim.", confidence: 0.96, materiality: "MATERIAL", proposedSeverity: "HIGH", humanReviewRequired: false, evidence: [{ evidenceRecordId: "claim", role: "PRIMARY", classification: "ADVERSE", rationale: null }], externalVerificationRequest: null };
    const projected = lunaObservationCandidate(observation, manifest);
    expect(projected).toMatchObject({ ruleKey: "LUNA-MEDICAL_DISEASE", detectedText: "Treats disease in people", scoreEligible: true, evidenceRecordIds: ["claim"] });
    expect(lunaObservationCandidate({ ...observation, evidence: [{ ...observation.evidence[0], evidenceRecordId: "invented" }] }, manifest)).toBeUndefined();
  });

  it("enforces strict classifications and risk themes in Luna output", () => {
    const result = lunaMerchantReviewSchema.safeParse({ version: "orbit-luna-review-v1", merchantSummary: { businessModel: "Research catalog", overallContext: "Observed globally", evidenceRecordIds: ["home-text"] }, observations: [{ issueKey: "bad", domain: "SEMANTIC_CONTEXT", category: "Claims", riskTheme: "MADE_UP_THEME", classification: "RISKY", conclusion: "Bad", confidence: 0.9, materiality: "MATERIAL", proposedSeverity: "HIGH", humanReviewRequired: false, evidence: [{ evidenceRecordId: "claim", role: "PRIMARY", classification: "ADVERSE", rationale: null }], externalVerificationRequest: null }], uncertainties: [] });
    expect(result.success).toBe(false);
  });

  it("routes semantic context to Luna and objective facts to the verifier", () => {
    expect(candidateDomain(candidate())).toBe("SEMANTIC_CONTEXT");
    expect(candidateDomain(candidate({ ruleKey: "POLICY-PRIVACY-001", category: "Policy coverage", scoreComponent: "POLICY_COVERAGE" }))).toBe("OBJECTIVE_FACT");
  });

  it("links deterministic candidates to retained exact evidence", () => {
    expect(attachRetainedCandidateEvidence(candidate(), manifest).evidenceRecordIds).toEqual(["claim"]);
  });

  it("never scores unresolved disagreements", () => {
    expect(isScorableCandidate(candidate({ scoreEligible: false }))).toBe(false);
    expect(isScorableCandidate(candidate({ scoreEligible: true }))).toBe(true);
  });
});
