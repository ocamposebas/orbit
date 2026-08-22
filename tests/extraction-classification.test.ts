import { describe, expect, it } from "vitest";
import { extractNormalizedContent } from "@/sentinel/extraction/extract";
import { classifyPage } from "@/sentinel/classification/classifier";
import { detectPolicySignals, complianceUrlPriority } from "@/sentinel/classification/policy-signals";
import { evaluateSiteCoverage } from "@/sentinel/analysis/rules";

describe("page intelligence", () => {
  it("extracts structured product content and classifies by combined signals", () => {
    const html = `<!doctype html><html><head><title>Reference Alpha 10mg</title><script type="application/ld+json">{"@type":"Product","name":"Reference Alpha","sku":"A-10"}</script></head><body><main><h1>Reference Alpha</h1><p>For research use only.</p><p>Price: $45.00</p><button>Add to cart</button></main></body></html>`;
    const content = extractNormalizedContent(html, "https://example.test/catalog/reference-alpha");
    expect(content.productName).toBe("Reference Alpha");
    expect(content.prices).toContain("$45.00");
    expect(content.disclaimers).toContain("For research use only.");
    expect(classifyPage("https://example.test/catalog/reference-alpha", content).pageType).toBe("PRODUCT");
  });

  it("detects multiple policies on a combined legal page", () => {
    const url = "https://example.test/pages/legal-and-policies";
    const content = extractNormalizedContent(`<main><h1>Legal policies</h1><section><h2>Privacy policy</h2><p>Personal information we collect and how we use your data.</p></section><section><h2>Terms of service</h2><p>These terms of service include a limitation of liability.</p></section><section><h2>Returns and refunds</h2><p>Our return policy provides a 30-day return window.</p></section><section><h2>Shipping and delivery</h2><p>Estimated delivery times and shipping rates are shown here.</p></section><section><h2>Contact us</h2><p>Send us a message through customer support.</p></section></main>`, url);
    expect(detectPolicySignals(url, content)).toEqual(expect.arrayContaining(["PRIVACY", "TERMS", "REFUND", "SHIPPING", "CONTACT"]));
    const findings = evaluateSiteCoverage([{ url, pageType: "POLICY", httpStatus: 200, content }]);
    expect(findings).toHaveLength(0);
  });

  it("recognizes common policy slugs and prioritizes them before catalog URLs", () => {
    const url = "https://example.test/pages/privacy-notice";
    const content = extractNormalizedContent("<main><h1>Privacy</h1></main>", url);
    expect(detectPolicySignals(url, content)).toContain("PRIVACY");
    expect(complianceUrlPriority(url)).toBeLessThan(complianceUrlPriority("https://example.test/products/reference-alpha"));
  });

  it("does not count a policy-looking 404 page as valid coverage", () => {
    const url = "https://example.test/pages/privacy-policy";
    const content = extractNormalizedContent("<main><h1>Page not found</h1></main>", url);
    const findings = evaluateSiteCoverage([{ url, pageType: "OTHER", httpStatus: 404, content }]);
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ ruleKey: "POLICY-PRIVACY-001" })]));
  });

  it("does not treat a global sign-in modal as a content login wall", () => {
    const content = extractNormalizedContent(`<body><div role="dialog"><form><p>Sign in to access your account</p><input type="password"></form></div><main><h1>Reference Alpha</h1><p>Laboratory research material.</p></main></body>`, "https://example.test/products/alpha");
    expect(content.controls.loginWall).toBe(false);
  });

  it("extracts product prices from structured data when visible currency is absent", () => {
    const content = extractNormalizedContent(`<head><script type="application/ld+json">{"@type":"Product","name":"Alpha","offers":{"price":"49.95","priceCurrency":"USD"}}</script></head><body><main><h1>Alpha</h1></main></body>`, "https://example.test/products/alpha");
    expect(content.prices).toContain("49.95");
  });
});
