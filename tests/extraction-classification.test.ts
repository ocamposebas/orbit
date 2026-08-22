import { describe, expect, it } from "vitest";
import { extractNormalizedContent } from "@/sentinel/extraction/extract";
import { classifyPage } from "@/sentinel/classification/classifier";

describe("page intelligence", () => {
  it("extracts structured product content and classifies by combined signals", () => {
    const html = `<!doctype html><html><head><title>Reference Alpha 10mg</title><script type="application/ld+json">{"@type":"Product","name":"Reference Alpha","sku":"A-10"}</script></head><body><main><h1>Reference Alpha</h1><p>For research use only.</p><p>Price: $45.00</p><button>Add to cart</button></main></body></html>`;
    const content = extractNormalizedContent(html, "https://example.test/catalog/reference-alpha");
    expect(content.productName).toBe("Reference Alpha");
    expect(content.prices).toContain("$45.00");
    expect(content.disclaimers).toContain("For research use only.");
    expect(classifyPage("https://example.test/catalog/reference-alpha", content).pageType).toBe("PRODUCT");
  });
});
