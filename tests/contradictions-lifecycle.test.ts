import { describe, expect, it } from "vitest";
import { extractNormalizedContent } from "@/sentinel/extraction/extract";
import { evaluateContradictions } from "@/sentinel/analysis/contradictions";
import { findingsToResolve } from "@/sentinel/analysis/lifecycle";
import { analyzeClaim, LocalSemanticAnalyzer } from "@/sentinel/analysis/semantic";
import { evaluatePage } from "@/sentinel/analysis/rules";

function page(url: string, type: "HOME" | "PRODUCT", body: string) { return { url, pageType: type, content: extractNormalizedContent(`<main><h1>Page</h1><p>${body}</p></main>`, url) }; }

describe("cross-page contradictions and finding lifecycle", () => {
  it("connects research positioning to conflicting catalog language", () => { const findings = evaluateContradictions([page("https://example.test/", "HOME", "For research use only."), page("https://example.test/product", "PRODUCT", "Supports rapid weight loss.")]); expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ ruleKey: "POSITION-CONFLICT-001", severity: "HIGH" })])); });
  it("flags direct human-use instructions but respects explicit research negation", async () => {
    expect(analyzeClaim("Take one capsule twice daily for personal use.").classification).toBe("administration_instruction");
    expect(analyzeClaim("Do not consume. Not for human use.").consumerDirected).toBe(false);
    const directUsePage = page("https://example.test/product", "PRODUCT", "Take one capsule twice daily for personal use.");
    const findings = await evaluatePage(directUsePage, new LocalSemanticAnalyzer());
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ ruleKey: "RSRCH-ADMIN-001", severity: "HIGH" })]));
  });
  it("flags consumer-directed language embedded in a public URL slug", async () => {
    const url = "https://example.test/products/alpha-weight-loss-dosage";
    const content = extractNormalizedContent("<main><h1>Alpha reference</h1><p>Laboratory research material only.</p></main>", url);
    const findings = await evaluatePage({ url, pageType: "PRODUCT", content }, new LocalSemanticAnalyzer());
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ ruleKey: "MKT-SLUG-001", severity: "HIGH" })]));
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
  it("resolves only signals absent from the new complete scan", () => { const active = [{ id: "keep", fingerprint: "a" }, { id: "resolve", fingerprint: "b" }]; expect(findingsToResolve(active, new Set(["a"]))).toEqual([{ id: "resolve", fingerprint: "b" }]); });
});
