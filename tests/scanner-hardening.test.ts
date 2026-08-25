import { describe, expect, it } from "vitest";
import { evaluateContradictions } from "@/sentinel/analysis/contradictions";
import { isMaterialCandidate, isScorableCandidate } from "@/sentinel/analysis/candidate-quality";
import { analyzeContext } from "@/sentinel/analysis/contextual-signals";
import { evaluatePage, evaluateSiteCoverage, requiredPolicyTypes } from "@/sentinel/analysis/rules";
import { LocalSemanticAnalyzer } from "@/sentinel/analysis/semantic";
import { classifyPage } from "@/sentinel/classification/classifier";
import { extractNormalizedContent } from "@/sentinel/extraction/extract";
import type { CandidateFinding, SentinelPageType } from "@/sentinel/types";

function page(url: string, pageType: SentinelPageType, html: string, httpStatus?: number) {
  return { url, pageType, content: extractNormalizedContent(html, url), httpStatus };
}

describe("scanner false-positive and safety gates", () => {
  it("does not classify a product-shaped URL without product or commerce evidence", () => {
    const url = "https://example.test/products/research-reference";
    const content = extractNormalizedContent("<main><h1>Research reference</h1><p>Laboratory documentation only.</p></main>", url);
    expect(classifyPage(url, content).pageType).toBe("OTHER");
  });

  it("treats isolated outcome and administration labels as ambiguous, not material claims", () => {
    expect(analyzeContext("Weight loss")).toEqual(expect.objectContaining({ type: "AMBIGUOUS", material: false }));
    expect(analyzeContext("Dosage: 2 mg")).toEqual(expect.objectContaining({ type: "AMBIGUOUS", material: false }));
    expect(analyzeContext("Supports rapid weight loss.")).toEqual(expect.objectContaining({ type: "HUMAN_OUTCOME", material: true }));
  });

  it("does not analyze quoted claim vocabulary on policy pages as marketing", async () => {
    const policy = page("https://example.test/research-policy", "POLICY", "<main><h1>Research policy</h1><p>We prohibit weight loss claims and dosage guidance.</p></main>");
    expect(await evaluatePage(policy, new LocalSemanticAnalyzer())).toEqual([]);
  });

  it("creates reviewable intended-use findings for public commercial research categories", async () => {
    const category = page("https://example.test/collections/research", "COLLECTION", "<main><h1>Obesity Research Products</h1><p>Muscle Growth Research Products</p><p>Cognitive Research Products</p><p>Reproductive Research Products</p><p>Recovery Research Products</p></main>");
    const findings = await evaluatePage(category, new LocalSemanticAnalyzer());
    expect(findings.filter((finding) => finding.ruleKey === "MKT-INTENDED-USE-001")).toHaveLength(5);
    expect(findings.every((finding) => finding.scoreComponent === "MARKETING_RISK")).toBe(true);
  });

  it("uses navigation as claim evidence without treating a repeated nav label as a product-page disclosure failure", async () => {
    const product = page("https://example.test/products/alpha", "PRODUCT", '<nav><a href="/collections/obesity">Obesity Research Products</a></nav><main><h1>Reference Alpha</h1><p>$30.00</p><button>Add to cart</button></main>');
    const findings = await evaluatePage(product, new LocalSemanticAnalyzer());
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ ruleKey: "MKT-INTENDED-USE-001" })]));
    expect(findings.some((finding) => finding.ruleKey === "PROD-DISC-001")).toBe(false);
  });

  it("uses a product title intended-use signal for the nearby-disclosure review", async () => {
    const product = page("https://example.test/products/obesity", "PRODUCT", '<main><h1>Obesity Research Product</h1><p>$30.00</p><button>Add to cart</button></main>');
    const findings = await evaluatePage(product, new LocalSemanticAnalyzer());
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ ruleKey: "MKT-INTENDED-USE-001" }), expect.objectContaining({ ruleKey: "PROD-DISC-001" })]));
  });

  it("does not demand a product disclaimer for neutral scientific copy", async () => {
    const product = page("https://example.test/products/reference", "PRODUCT", '<main><h1>Reference compound</h1><p>$30.00</p><button>Add to cart</button><p>Studied in preclinical models of metabolic signaling.</p></main>');
    const findings = await evaluatePage(product, new LocalSemanticAnalyzer());
    expect(findings.some((finding) => finding.ruleKey === "PROD-DISC-001")).toBe(false);
  });

  it("requires commerce policies only when the observed business model makes them applicable", () => {
    const service = page("https://example.test/", "HOME", "<main><h1>Consulting</h1><p>Professional services and software consulting.</p></main>");
    expect(requiredPolicyTypes([service])).toEqual(["PRIVACY", "TERMS", "CONTACT"]);

    const product = page("https://example.test/products/widget", "PRODUCT", '<main><h1>Widget</h1><p>$25.00</p><button>Add to cart</button></main>');
    expect(requiredPolicyTypes([product])).toEqual(["PRIVACY", "TERMS", "CONTACT", "REFUND", "SHIPPING"]);
  });

  it("does not assert missing policies when crawl coverage is too incomplete", () => {
    const home = page("https://example.test/", "HOME", "<main><h1>Store</h1></main>");
    expect(evaluateSiteCoverage([home], { coverageRatio: 0.5 })).toEqual([]);
    const uncertain = evaluateSiteCoverage([home], { coverageRatio: 0.7 });
    expect(uncertain.every((finding) => finding.status === "NEEDS_REVIEW" && finding.confidence === 0.74)).toBe(true);
  });

  it("keeps uncertain review candidates out of scoring and merchant-level alarms", () => {
    const finding: CandidateFinding = { ruleKey: "UNCERTAIN-001", severity: "HIGH", confidence: 0.72, status: "NEEDS_REVIEW", category: "Review", title: "Uncertain", description: "Uncertain signal", url: "https://example.test", pageType: "HOME", reason: "Weak context", recommendedAction: "Review", scoreComponent: "MARKETING_RISK" };
    expect(isScorableCandidate(finding)).toBe(false);
    expect(isMaterialCandidate(finding)).toBe(false);
  });

  it("does not manufacture a cosmetic contradiction from an exclusion policy itself", () => {
    const policy = page("https://example.test/policy", "POLICY", "<main><h1>Use policy</h1><p>Not intended for cosmetic enhancement.</p></main>");
    expect(evaluateContradictions([policy]).some((finding) => finding.ruleKey === "POSITION-COSMETIC-CONFLICT-001")).toBe(false);
  });

  it("ignores error responses even when their template contains risky vocabulary", async () => {
    const notFound = page("https://example.test/products/missing", "PRODUCT", "<main><h1>404</h1><p>Try weight loss dosage search.</p></main>", 404);
    expect(await evaluatePage(notFound, new LocalSemanticAnalyzer())).toEqual([]);
  });
});
