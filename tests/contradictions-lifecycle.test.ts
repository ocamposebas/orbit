import { describe, expect, it } from "vitest";
import { extractNormalizedContent } from "@/sentinel/extraction/extract";
import { evaluateContradictions } from "@/sentinel/analysis/contradictions";
import { findingsToResolve } from "@/sentinel/analysis/lifecycle";

function page(url: string, type: "HOME" | "PRODUCT", body: string) { return { url, pageType: type, content: extractNormalizedContent(`<main><h1>Page</h1><p>${body}</p></main>`, url) }; }

describe("cross-page contradictions and finding lifecycle", () => {
  it("connects research positioning to conflicting catalog language", () => { const findings = evaluateContradictions([page("https://example.test/", "HOME", "For research use only."), page("https://example.test/product", "PRODUCT", "Supports rapid weight loss.")]); expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ ruleKey: "POSITION-CONFLICT-001", severity: "HIGH" })])); });
  it("resolves only signals absent from the new complete scan", () => { const active = [{ id: "keep", fingerprint: "a" }, { id: "resolve", fingerprint: "b" }]; expect(findingsToResolve(active, new Set(["a"]))).toEqual([{ id: "resolve", fingerprint: "b" }]); });
});
