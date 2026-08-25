import { describe, expect, it } from "vitest";
import { extractNormalizedContent } from "@/sentinel/extraction/extract";
import { classifyPage, hasProductEvidence, verifiedCanonicalProductUrl } from "@/sentinel/classification/classifier";
import { coverageForAssessment, surfaceCoverage, weightedCoverage } from "@/sentinel/analysis/coverage";
import { calculateHealthScore } from "@/sentinel/analysis/score";
import { findingSpecificRemediation, merchantReportHtml } from "@/sentinel/reports/merchant-pdf";

function evidence(overrides: Record<string, unknown>) {
  return {
    id: "finding-evidence-default",
    evidenceRecordId: "evidence-record-default",
    kind: "TEXT",
    pageUrl: "https://example.test/products/alpha",
    normalizedText: null,
    evidenceSnippet: null,
    pageHash: "hash",
    domSelector: null,
    storageKey: null,
    ruleVersion: null,
    modelVersion: "gpt-5.6-luna",
    classificationConfidence: 0.96,
    metadata: {},
    createdAt: new Date("2026-08-25T12:00:00Z"),
    ...overrides,
  };
}

function finding(overrides: Record<string, unknown> = {}) {
  return {
    id: "finding-1",
    organizationId: "organization-1",
    merchantId: "merchant-1",
    siteId: "site-1",
    scanId: "scan-1",
    ruleVersionId: null,
    adjudicationId: null,
    severity: "HIGH",
    confidence: 0.96,
    status: "NEEDS_REVIEW",
    category: "Claims & intended use",
    title: "Potential administration instruction",
    description: "Consumer-style dosing language was retained.",
    url: "https://example.test/products/alpha",
    pageType: "PRODUCT",
    detectedText: "Inject 2 mg daily.",
    reason: "The wording gives a dose, route, and frequency.",
    recommendedAction: "Review the cited first-party evidence in its complete merchant context and remediate the supported issue.",
    fingerprint: "fingerprint-1",
    firstDetectedAt: new Date("2026-08-25T12:00:00Z"),
    lastDetectedAt: new Date("2026-08-25T12:00:00Z"),
    resolvedAt: null,
    resolvedByScanId: null,
    createdAt: new Date("2026-08-25T12:00:00Z"),
    updatedAt: new Date("2026-08-25T12:00:00Z"),
    adjudication: { outcome: "PRIMARY_ACCEPTED" },
    evidence: [],
    ...overrides,
  };
}

function reportFixture() {
  const productEvidence = [
    evidence({ id: "fe-adverse", evidenceRecordId: "ev-adverse", evidenceSnippet: "Inject 2 mg daily.", metadata: { evidenceClassification: "ADVERSE", role: "primary", sourceKind: "TEXT", evidenceType: "BODY", riskTheme: "HUMAN_ADMINISTRATION" } }),
    evidence({ id: "fe-mitigating", evidenceRecordId: "ev-mitigating", evidenceSnippet: "For research use only. Not for human consumption.", metadata: { evidenceClassification: "ADVERSE", role: "merchant-level-restriction", sourceKind: "TEXT", evidenceType: "DISCLAIMER" } }),
    evidence({ id: "fe-neutral", evidenceRecordId: "ev-neutral", evidenceSnippet: "Certificate of analysis is available.", metadata: { evidenceClassification: "INFORMATIONAL", role: "supporting", sourceKind: "DOCUMENT", evidenceType: "DOCUMENT_LINK" } }),
  ];
  return {
    id: "merchant-1",
    businessName: "Example Merchant",
    sites: [{ hostname: "example.test" }],
    healthScores: [{
      total: 82,
      formulaVersion: "orbit-health-v9",
      components: [{ key: "SITE_CONTROLS", label: "Checkout risk controls", score: 70 }],
      scan: {
        id: "scan-1",
        completedAt: new Date("2026-08-25T12:00:00Z"),
        pagesProcessed: 5,
        pagesDiscovered: 5,
        productsDetected: 2,
        progress: { scanCoveragePercent: 73, checkoutStatesInspected: 0, visualPagesAnalyzed: 2, documentsAnalyzed: 1 },
        intelligence: { coverage: { overall: 73, surfaces: { pages: { state: "OBSERVED", inspected: 5, expected: 5, percent: 100 }, products: { state: "OBSERVED", inspected: 2, expected: 2, percent: 100 }, semantic: { state: "OBSERVED", inspected: 5, expected: 5, percent: 100 }, visual: { state: "OBSERVED", inspected: 2, expected: 2, percent: 100 }, documents: { state: "OBSERVED", inspected: 1, expected: 1, percent: 100 }, checkout: { state: "NOT_OBSERVED", inspected: 0, expected: 1, percent: 0 } } }, evidenceGraph: {}, methodologyLimitations: [] },
      },
    }],
    findings: [finding({ evidence: productEvidence })],
    policies: [],
    products: [
      { id: "product-alpha", name: "Alpha", sku: "ALPHA-10", canonicalUrl: "https://example.test/products/alpha", variants: [{ name: "10 mg", sku: "ALPHA-10-V1" }], snapshots: [{ scanId: "scan-1" }] },
      { id: "product-beta", name: "Beta", sku: null, canonicalUrl: "https://example.test/products/beta", variants: [], snapshots: [{ scanId: "scan-1" }] },
      { id: "article-stale", name: "A peptide guide", sku: "GUESSED", canonicalUrl: "https://example.test/insights/peptide-guide", variants: [], snapshots: [{ scanId: "scan-1" }] },
    ],
    _count: { products: 3 },
  };
}

describe("Sentinel product and report correctness", () => {
  it("never classifies an editorial or insights page as a product", () => {
    const url = "https://example.test/insights/alpha-guide";
    const content = extractNormalizedContent(`<script type="application/ld+json">{"@type":"Product","name":"Alpha","sku":"A-1"}</script><article><h1>Alpha guide</h1><p>$49.00</p><button>Add to cart</button></article>`, url);
    expect(hasProductEvidence(content, url)).toBe(false);
    expect(classifyPage(url, content).pageType).toBe("ARTICLE");
  });

  it("retains verified product SKU and leaves absent SKU unknown", () => {
    const withSku = extractNormalizedContent(`<script type="application/ld+json">{"@type":"Product","name":"Alpha","sku":"ALPHA-10","offers":{"price":"49"}}</script><h1>Alpha</h1>`, "https://example.test/products/alpha");
    const withoutSku = extractNormalizedContent(`<script type="application/ld+json">{"@type":"Product","name":"Beta","offers":{"price":"59"}}</script><h1>Beta</h1>`, "https://example.test/products/beta");
    expect(classifyPage("https://example.test/products/alpha", withSku).pageType).toBe("PRODUCT");
    expect(withSku.sku).toBe("ALPHA-10");
    expect(classifyPage("https://example.test/products/beta", withoutSku).pageType).toBe("PRODUCT");
    expect(withoutSku.sku).toBeUndefined();
  });

  it("extracts variation SKUs and validates the canonical product URL", () => {
    const url = "https://example.test/products/alpha?variant=1";
    const content = extractNormalizedContent(`<script type="application/ld+json">{"@type":"Product","name":"Alpha"}</script><h1>Alpha</h1><select name="variant"><option data-sku="ALPHA-10" value="10">10 mg</option><option data-sku="ALPHA-20" value="20">20 mg</option></select>`, url);
    expect(content.productVariations).toEqual(expect.arrayContaining([expect.objectContaining({ name: "10 mg", sku: "ALPHA-10" }), expect.objectContaining({ name: "20 mg", sku: "ALPHA-20" })]));
    expect(verifiedCanonicalProductUrl(url, "/products/alpha")).toBe("https://example.test/products/alpha");
    expect(verifiedCanonicalProductUrl(url, "https://example.test/insights/alpha")).toBe(url);
  });

  it("represents zero checkout observations and unknown coverage without awarding 100", () => {
    const checkout = surfaceCoverage({ inspected: 0, expected: 1, applicable: true });
    const unknown = surfaceCoverage({ inspected: 0, expected: 0, known: false });
    expect(checkout).toEqual({ state: "NOT_OBSERVED", percent: 0, inspected: 0, expected: 1 });
    expect(unknown.state).toBe("UNKNOWN");
    expect(coverageForAssessment(unknown)).toBe(0);
    expect(weightedCoverage([{ weight: 1, coverage: checkout }])).toBe(0);
    expect(calculateHealthScore([], { SITE_CONTROLS: coverageForAssessment(unknown) }).components.find((component) => component.key === "SITE_CONTROLS")?.score).toBe(70);
  });

  it("renders verified SKU, canonical URL, variation SKU, and explicit missing SKU in the PDF HTML", () => {
    const html = merchantReportHtml(reportFixture() as never);
    const productsSection = html.slice(html.indexOf("Products reviewed"), html.indexOf("Policy coverage"));
    expect(productsSection).toContain("Alpha");
    expect(productsSection).toContain("SKU: ALPHA-10");
    expect(productsSection).toContain("ALPHA-10-V1");
    expect(productsSection).toContain("https://example.test/products/alpha");
    expect(productsSection).toContain("SKU: Not observed");
    expect(productsSection).not.toContain("/insights/peptide-guide");
  });

  it("separates adverse, mitigating, and supporting evidence with audit provenance", () => {
    const html = merchantReportHtml(reportFixture() as never);
    expect(html).toContain("ADVERSE EVIDENCE");
    expect(html).toContain("MITIGATING EVIDENCE");
    expect(html).toContain("NEUTRAL / SUPPORTING CONTEXT");
    expect(html).toContain("Evidence ID: ev-adverse");
    expect(html).toContain("Evidence ID: ev-mitigating");
    expect(html).toContain("For research use only. Not for human consumption.");
    expect(html).toContain("HUMAN_ADMINISTRATION");
    const adverseSection = html.slice(html.indexOf("ADVERSE EVIDENCE"), html.indexOf("MITIGATING EVIDENCE"));
    const mitigatingSection = html.slice(html.indexOf("MITIGATING EVIDENCE"), html.indexOf("NEUTRAL / SUPPORTING CONTEXT"));
    expect(adverseSection).not.toContain("Not for human consumption");
    expect(mitigatingSection).toContain("Not for human consumption");
  });

  it("generates finding-specific remediation from retained evidence and renders it in the PDF", () => {
    const fixture = reportFixture();
    const remediation = findingSpecificRemediation(fixture.findings[0] as never, fixture.findings[0].evidence as never);
    expect(remediation).toContain("remove or rewrite");
    expect(remediation).toContain("Inject 2 mg daily.");
    const html = merchantReportHtml(fixture as never);
    expect(html).toContain("RECOMMENDED REMEDIATION");
    expect(html).toContain("Inject 2 mg daily.");
    expect(html).toContain("70 · NOT OBSERVED");
  });

  it("labels article findings as editorial rather than products", () => {
    const fixture = reportFixture();
    fixture.findings = [finding({ url: "https://example.test/insights/recovery", pageType: "ARTICLE", title: "Recovery article claim", evidence: [evidence({ pageUrl: "https://example.test/insights/recovery", evidenceSnippet: "Accelerates healing.", metadata: { evidenceClassification: "ADVERSE", riskTheme: "RECOVERY_HEALING" } })] })];
    const html = merchantReportHtml(fixture as never);
    expect(html).toContain("Content type");
    expect(html).toContain("Editorial / Article");
    expect(html).toContain("Verified product SKU</label><p>Not applicable");
  });
});
