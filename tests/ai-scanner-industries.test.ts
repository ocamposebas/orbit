import { describe, expect, it } from "vitest";
import { lunaAuditResultSchema } from "@/ai-scanner/schemas";

const industries = [
  { industry: "apparel", contentType: "product", product: "Linen shirt", category: "Shirts" },
  { industry: "research/laboratory ecommerce", contentType: "product", product: "Reference standard", category: "Standards" },
  { industry: "electronics", contentType: "product", product: "USB-C hub", category: "Accessories" },
  { industry: "homewares", contentType: "category", product: "Stoneware set", category: "Dining" },
  { industry: "SaaS", contentType: "pricing", product: null, category: "Plans" },
  { industry: "industrial equipment", contentType: "product", product: "Bench press", category: "Machinery" },
  { industry: "editorial-heavy ecommerce", contentType: "article-linked-product", product: "Field guide", category: "Books" },
];

describe.each(industries)("AI Scanner structured result: $industry", ({ contentType, product, category }) => {
  it("preserves industry-neutral evidence, affected entities, and contextual remediation", () => {
    const result = lunaAuditResultSchema.parse({ summary: "Evidence-backed audit.", observations: [{ text: "Rendered surface inspected.", evidenceIds: ["ev-1"] }], findings: [{ title: "Observed commercial issue", severity: "MEDIUM", confidence: 0.75, theme: "Commercial context", category: "Representation", materiality: "MATERIAL", materialityWeight: 0.7, commercialProminence: 0.6, visualProminence: 0.5, productAssociation: product !== null, mitigation: 0.1, ambiguous: false, contradictoryEvidence: false, explanation: "The conclusion is tied to the retained composition.", affectedUrl: "https://merchant.example/surface", contentType, affectedProduct: product, affectedCategory: category, verifiedSku: null, adverseEvidence: [{ evidenceId: "ev-1", rationale: "Rendered evidence" }], mitigatingEvidence: [], neutralEvidence: [], screenshotEvidenceIds: ["ev-1"], remediation: `Revise the observed ${contentType} composition.`, }], limitations: [] });
    expect(result.findings[0].contentType).toBe(contentType);
    expect(result.findings[0].affectedProduct).toBe(product);
    expect(result.findings[0].verifiedSku).toBeNull();
  });
});
