import { describe, expect, it } from "vitest";
import { buildProductIntelligence, deterministicAbbreviation, inferBrandPrefix } from "@/sentinel/analysis/product-intelligence";
import { evaluateWebsiteLegitimacy } from "@/sentinel/analysis/legitimacy";
import { extractNormalizedContent } from "@/sentinel/extraction/extract";

describe("product intelligence and website legitimacy", () => {
  it.each([["Phase One Labz", "PL"], ["RGVPRIME LLC", "RG"]])("uses a stable brand prefix for %s", (brand, expected) => expect(inferBrandPrefix(brand)).toBe(expected));

  it("creates deterministic abbreviations without obfuscated substitutions", () => {
    expect(deterministicAbbreviation("Nova Compound")).toBe("NC");
    expect(deterministicAbbreviation("Semax")).toBe("SMX");
    expect(deterministicAbbreviation("Semax")).toBe(deterministicAbbreviation("Semax"));
  });

  it("retains canonical identity separately from a branded recommendation", () => {
    const url = "https://example.test/product/pl-rt";
    const content = extractNormalizedContent(`<head><meta name="description" content="Retatrutide analytical reference"><script type="application/ld+json">{"@type":"Product","name":"PL-RT","sku":"OLD-1"}</script></head><body><main><h1>PL-RT 20mg</h1><p>Retatrutide analytical reference for research use only.</p><img src="/images/retatrutide-20mg.webp" alt="Retatrutide research vial"><a href="/coa/retatrutide-20mg.pdf">Certificate</a></main></body>`, url);
    const intelligence = buildProductIntelligence(content, url, "Phase One Labz");
    expect(intelligence).toEqual(expect.objectContaining({ canonicalCompoundName: "Retatrutide", recommendedDisplayIdentifier: "PL-RT", suggestedSku: "PL-RT-20MG", canonicalIdentityRetained: true, recommendationOnly: true }));
    expect(content.images[0]).toEqual(expect.objectContaining({ filename: "retatrutide-20mg.webp", alt: "Retatrutide research vial" }));
    expect(content.certificateLinks).toContain("https://example.test/coa/retatrutide-20mg.pdf");
  });

  it("does not penalize a normal discount or absence of promotions", () => {
    const url = "https://example.test/";
    const content = extractNormalizedContent("<main><h1>Research catalog</h1><p>Selected references are 10% off this week.</p></main>", url);
    expect(evaluateWebsiteLegitimacy([{ url, pageType: "HOME", httpStatus: 200, content }])).toHaveLength(0);
  });

  it("flags only explicit public placeholders, not basic design", () => {
    const url = "https://example.test/";
    const content = extractNormalizedContent("<main><h1>Your Company</h1><p>Lorem ipsum dolor sit amet.</p></main>", url);
    expect(evaluateWebsiteLegitimacy([{ url, pageType: "HOME", httpStatus: 200, content }])).toEqual(expect.arrayContaining([expect.objectContaining({ ruleKey: "SITE-PLACEHOLDER-001", severity: "MEDIUM" })]));
  });
});

