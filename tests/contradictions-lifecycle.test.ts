import { describe, expect, it } from "vitest";
import { extractNormalizedContent } from "@/sentinel/extraction/extract";
import { evaluateContradictions } from "@/sentinel/analysis/contradictions";
import { findingsToResolve } from "@/sentinel/analysis/lifecycle";
import { analyzeClaim, LocalSemanticAnalyzer } from "@/sentinel/analysis/semantic";
import { evaluatePage } from "@/sentinel/analysis/rules";
import { analyzeContext } from "@/sentinel/analysis/contextual-signals";
import { consolidateCandidates } from "@/sentinel/analysis/candidate-quality";

function page(url: string, type: "HOME" | "PRODUCT", body: string) { return { url, pageType: type, content: extractNormalizedContent(`<main><h1>Page</h1><p>${body}</p></main>`, url) }; }

describe("cross-page contradictions and finding lifecycle", () => {
  it("connects research positioning to conflicting catalog language", () => { const findings = evaluateContradictions([page("https://example.test/", "HOME", "For research use only."), page("https://example.test/product", "PRODUCT", "Supports rapid weight loss.")]); expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ ruleKey: "POSITION-CONFLICT-001", severity: "HIGH" })])); });
  it("flags direct human-use instructions but respects explicit research negation", async () => {
    expect(analyzeClaim("Take one capsule twice daily for personal use.").classification).toBe("administration_instruction");
    expect(analyzeClaim("Do not consume. Not for human use.").consumerDirected).toBe(false);
    const directUsePage = page("https://example.test/product", "PRODUCT", "Take one capsule twice daily for personal use.");
    const findings = await evaluatePage(directUsePage, new LocalSemanticAnalyzer());
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ ruleKey: "RSRCH-ADMIN-001", severity: "CRITICAL" })]));
  });
  it("flags consumer-directed language embedded in a public URL slug", async () => {
    const url = "https://example.test/products/alpha-weight-loss-dosage";
    const content = extractNormalizedContent("<main><h1>Alpha reference</h1><p>Laboratory research material only.</p></main>", url);
    const findings = await evaluatePage({ url, pageType: "PRODUCT", content }, new LocalSemanticAnalyzer());
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ ruleKey: "MKT-SLUG-001", severity: "MEDIUM" })]));
  });
  it("treats an explicit prohibition on human consumption as research context", () => {
    const text = "No product is offered, intended, or permitted for human consumption or for any personal or non-research purpose.";
    expect(analyzeClaim(text)).toEqual(expect.objectContaining({ classification: "neutral", consumerDirected: false, risk: "none", signalType: "RESEARCH_RESTRICTION" }));
  });
  it("does not build a contradiction from the prohibited activity inside a research policy", () => {
    const research = page("https://example.test/", "HOME", "All materials are strictly for laboratory research.");
    const policy = page("https://example.test/policies", "HOME", "No product is offered, intended, or permitted for human consumption or for any personal or non-research purpose.");
    expect(evaluateContradictions([research, policy]).some((finding) => finding.ruleKey === "POSITION-CONFLICT-001")).toBe(false);
  });
  it("pairs separate primary and research-positioning evidence for a real contradiction", () => {
    const research = page("https://example.test/policies", "HOME", "No product is intended or permitted for human consumption.");
    const product = page("https://example.test/product", "PRODUCT", "Inject 2mg weekly to lose weight.");
    const finding = evaluateContradictions([research, product]).find((item) => item.ruleKey === "POSITION-CONFLICT-001");
    expect(finding).toEqual(expect.objectContaining({ severity: "CRITICAL", detectedText: "Inject 2mg weekly to lose weight.", secondaryEvidence: expect.objectContaining({ url: research.url, role: "research-positioning" }) }));
  });
  it.each([
    ["Investigated in preclinical receptor-binding models.", "SCIENTIFIC_DISCUSSION", false],
    ["Inject 2mg weekly to lose weight.", "HUMAN_ADMINISTRATION", true],
    ["Reconstitute with 2ml and administer once weekly.", "HUMAN_ADMINISTRATION", true],
    ["Treats diabetes and prevents cardiovascular disease.", "MEDICAL_CLAIM", true],
    ["I lost weight and my energy improved in 3 weeks.", "HUMAN_TESTIMONIAL", true],
    ["Before and after body transformation photos.", "BEFORE_AFTER_OUTCOME", true],
    ["Available to pharmacy partners.", "PRESCRIPTION_SIGNAL", false],
    ["This analytical reference is supplied with bacteriostatic water.", "SCIENTIFIC_DISCUSSION", false],
    ["Injection", "AMBIGUOUS", false],
    ["No content on this website shall be interpreted as medical advice, dosage guidance, treatment guidance, or a recommendation for any non-research use.", "RESEARCH_RESTRICTION", false],
    ["Products are not intended to diagnose, treat, cure, mitigate, or prevent any disease or condition.", "RESEARCH_RESTRICTION", false],
    ["Products must not be used in connection with self-experimentation, personal wellness, bodybuilding, weight loss, anti-aging, cosmetic enhancement, treatment, prevention, diagnosis, cure, mitigation, or management of any disease, condition, symptom, or physical objective.", "RESEARCH_RESTRICTION", false],
    ["Product descriptions do not constitute instructions, warranties, medical claims, safety claims, dosage guidance, therapeutic claims, or recommendations for any use in living organisms.", "RESEARCH_RESTRICTION", false],
    ["Nothing on this website should be interpreted as medical advice, veterinary advice, dosage guidance, formulation guidance, compounding instructions, treatment guidance, or a recommendation for use in any living organism.", "RESEARCH_RESTRICTION", false],
    ["Phase One Labz does not make, support, authorize, adopt, or endorse any medical, health, therapeutic, diagnostic, cosmetic, weight-loss, wellness, performance, or disease-related claim regarding any product.", "RESEARCH_RESTRICTION", false],
    ["Phase One Labz does not provide medical advice, dosage instructions, diagnosis, treatment recommendations, or safety instructions for human or animal use.", "RESEARCH_RESTRICTION", false],
    ["Products have not been evaluated or authorized for diagnosis, treatment, cure, mitigation, or prevention of any disease.", "RESEARCH_RESTRICTION", false],
    ["We improve website performance and maintain account functionality.", "NONE", false],
    ["This information helps us operate the website, improve performance, detect fraud, prevent abuse, troubleshoot issues, and understand customer behavior.", "NONE", false],
    ["Not intended for human use, but inject 2mg weekly.", "HUMAN_ADMINISTRATION", true],
  ])("classifies contextual text without raw keyword conclusions: %s", (text, type, material) => {
    expect(analyzeContext(text)).toEqual(expect.objectContaining({ type, material }));
  });
  it("does not report concentration mismatch when all concentrations are declared variants", () => {
    const url = "https://example.test/products/alpha";
    const content = extractNormalizedContent(`<main><h1>Reference Alpha 5mg</h1><select name="variant"><option>5mg</option><option>10mg</option></select><p>Available as 10mg for laboratory analysis.</p></main>`, url);
    expect(evaluateContradictions([{ url, pageType: "PRODUCT", content }]).some((finding) => finding.ruleKey === "PRODUCT-CONCENTRATION-001")).toBe(false);
  });
  it("reports a real heading-to-body concentration mismatch", () => {
    const url = "https://example.test/products/alpha";
    const content = extractNormalizedContent(`<main><h1>Reference Alpha 5mg</h1><p>This vial contains 10mg of research material.</p></main>`, url);
    expect(evaluateContradictions([{ url, pageType: "PRODUCT", content }])).toEqual(expect.arrayContaining([expect.objectContaining({ ruleKey: "PRODUCT-CONCENTRATION-001", severity: "MEDIUM" })]));
  });
  it("does not compare product mass with an unrelated liquid volume", () => {
    const url = "https://example.test/products/alpha";
    const content = extractNormalizedContent(`<main><h1>Reference Alpha 20mg</h1><p>Laboratory preparation may use a 2ml vial.</p></main>`, url);
    expect(evaluateContradictions([{ url, pageType: "PRODUCT", content }]).some((finding) => finding.ruleKey === "PRODUCT-CONCENTRATION-001")).toBe(false);
  });
  it("does not call two package volumes a concentration mismatch", () => {
    const url = "https://example.test/products/recon-water-30ml";
    const content = extractNormalizedContent(`<main><h1>Research water 30ml</h1><p>Related laboratory containers are also available in 3ml format.</p></main>`, url);
    expect(evaluateContradictions([{ url, pageType: "PRODUCT", content }]).some((finding) => finding.ruleKey === "PRODUCT-CONCENTRATION-001")).toBe(false);
  });
  it("does not assess a post-purchase confirmation as checkout", async () => {
    const url = "https://example.test/checkout/thank-you";
    const content = extractNormalizedContent(`<main><h1>Thank you</h1><p>Your order has been received.</p></main>`, url);
    expect(await evaluatePage({ url, pageType: "CHECKOUT", content }, new LocalSemanticAnalyzer())).not.toEqual(expect.arrayContaining([expect.objectContaining({ ruleKey: "CHECKOUT-TERMS-001" })]));
  });
  it("consolidates a material claim into its stronger cross-page contradiction", () => {
    const shared = { severity: "HIGH" as const, confidence: 0.92, status: "NEEDS_REVIEW" as const, category: "Marketing", title: "Claim", description: "Observed", url: "https://example.test/product", pageType: "PRODUCT" as const, detectedText: "Supports rapid weight loss.", reason: "Reason", recommendedAction: "Review", scoreComponent: "MARKETING_RISK" as const };
    const findings = consolidateCandidates([{ ...shared, ruleKey: "MKT-CLAIM-001" }, { ...shared, ruleKey: "POSITION-CONFLICT-001", category: "Positioning", scoreComponent: "OPERATIONAL_CONSISTENCY" }]);
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleKey).toBe("POSITION-CONFLICT-001");
  });
  it("resolves only signals absent from the new complete scan", () => { const active = [{ id: "keep", fingerprint: "a" }, { id: "resolve", fingerprint: "b" }]; expect(findingsToResolve(active, new Set(["a"]))).toEqual([{ id: "resolve", fingerprint: "b" }]); });
});
