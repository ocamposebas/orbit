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

  it("does not treat a cross-reference as the referenced policy", () => {
    const url = "https://example.test/policies/research-use-only";
    const content = extractNormalizedContent("<main><h1>Research Use Only Policy</h1><p>Cancelled orders are handled according to our Refund Policy.</p><p>All materials are for laboratory research only.</p></main>", url);
    expect(detectPolicySignals(url, content, "POLICY")).toContain("RESEARCH_USE");
    expect(detectPolicySignals(url, content, "POLICY")).not.toContain("REFUND");
  });

  it("extracts checkbox label text for checkout-control analysis", () => {
    const content = extractNormalizedContent(`<main><form><label><input type="checkbox" name="accept" required> I accept the Terms and Conditions</label><button>Place order</button></form></main>`, "https://example.test/checkout");
    expect(content.forms[0].fields[0]).toEqual(expect.objectContaining({ label: "I accept the Terms and Conditions", checked: false, required: true }));
  });

  it("keeps regulatory abbreviations attached to their negating sentence", () => {
    const sentence = "Products have not been evaluated or authorized by the U.S. Food and Drug Administration for diagnosis, treatment, cure, mitigation, or prevention of disease.";
    const content = extractNormalizedContent(`<main><p>${sentence}</p></main>`, "https://example.test/policies/disclaimer");
    expect(content.claims).toContain(sentence);
    expect(content.claims.some((claim) => claim.startsWith("Food and Drug"))).toBe(false);
  });

  it("does not count a policy-looking 404 page as valid coverage", () => {
    const url = "https://example.test/pages/privacy-policy";
    const content = extractNormalizedContent("<main><h1>Page not found</h1></main>", url);
    const findings = evaluateSiteCoverage([{ url, pageType: "OTHER", httpStatus: 404, content }]);
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ ruleKey: "POLICY-PRIVACY-001" })]));
  });

  it("classifies a thank-you receipt as post-purchase content, not checkout", () => {
    const url = "https://example.test/checkout/thank-you";
    const content = extractNormalizedContent("<main><h1>Thank you</h1><p>Your order is complete.</p></main>", url);
    expect(classifyPage(url, content)).toEqual(expect.objectContaining({ pageType: "OTHER", confidence: 0.99 }));
  });

  it("does not treat a global sign-in modal as a content login wall", () => {
    const content = extractNormalizedContent(`<body><div role="dialog"><form><p>Sign in to access your account</p><input type="password"></form></div><main><h1>Reference Alpha</h1><p>Laboratory research material.</p></main></body>`, "https://example.test/products/alpha");
    expect(content.controls.loginWall).toBe(false);
  });

  it("does not claim a product was inspected when its URL returns only an access wall", () => {
    const url = "https://example.test/product/private-reference";
    const content = extractNormalizedContent(`<main><h1>Welcome back</h1><p>Sign in to continue to the private catalog.</p><form><input type="email"><input type="password"><button>Sign in</button></form></main>`, url);
    expect(classifyPage(url, content)).toEqual(expect.objectContaining({ pageType: "ACCOUNT", confidence: 0.98 }));
  });

  it("extracts product prices from structured data when visible currency is absent", () => {
    const content = extractNormalizedContent(`<head><script type="application/ld+json">{"@type":"Product","name":"Alpha","offers":{"price":"49.95","priceCurrency":"USD"}}</script></head><body><main><h1>Alpha</h1></main></body>`, "https://example.test/products/alpha");
    expect(content.prices).toContain("49.95");
  });
});
