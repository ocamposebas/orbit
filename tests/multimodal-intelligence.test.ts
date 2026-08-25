import { describe, expect, it } from "vitest";
import { extractNormalizedContent } from "@/sentinel/extraction/extract";
import { visualAnalysisSchema, visualCandidates, type VisualAsset } from "@/sentinel/analysis/visual-intelligence";
import { documentCandidates, documentSemanticAnalysisSchema, extractDocumentMetadata, type ExtractedDocument } from "@/sentinel/analysis/document-intelligence";
import { buildEvidenceGraph } from "@/sentinel/analysis/evidence-graph";
import { calculateHealthScore } from "@/sentinel/analysis/score";
import type { CandidateFinding } from "@/sentinel/types";

const productUrl = "https://merchant.example/products/alpha?size=10mg&ref=catalog";

describe("multimodal merchant intelligence", () => {
  it("normalizes rendered commercial, product, location, document, and DOM evidence", () => {
    const content = extractNormalizedContent(`<!doctype html><html><head><title>Alpha</title><meta name="description" content="Short meta"><meta property="og:image" content="hero.jpg"><script type="application/ld+json">{"@type":"Product","name":"Alpha","sku":"A-10","category":"Recovery"}</script></head><body><header><nav><a href="/collections/performance">Performance</a></nav></header><main><h1>Alpha</h1><h4>Technical details</h4><div class="woocommerce-product-details__short-description">Short product description</div><div class="product-description">Full product description</div><span class="badge">Best seller</span><span class="stock">In stock</span><select name="variant"><option value="10" data-sku="A-10-V">10 mg</option></select><a class="button" href="/cart">Buy now</a><img src="/alpha-vial.jpg" alt="Alpha research vial"><a href="/coa/alpha.pdf">Certificate of Analysis</a></main><footer><p>Research use only</p></footer></body></html>`, productUrl, { originalUrl: "https://merchant.example/p/alpha" });
    expect(content.location).toEqual(expect.objectContaining({ originalUrl: "https://merchant.example/p/alpha", pathname: "/products/alpha", queryParams: { size: ["10mg"], ref: ["catalog"] } }));
    expect(content.headingRecords).toEqual(expect.arrayContaining([expect.objectContaining({ text: "Technical details", level: 4 })]));
    expect(content.navigation).toEqual(expect.arrayContaining([expect.objectContaining({ text: "Performance" })]));
    expect(content.footer).toEqual(expect.arrayContaining([expect.objectContaining({ text: "Research use only" })]));
    expect(content.linkCtas).toEqual(expect.arrayContaining([expect.objectContaining({ text: "Buy now" })]));
    expect(content.descriptions).toEqual({ short: "Short product description", full: "Full product description" });
    expect(content.productVariations).toEqual([expect.objectContaining({ name: "10 mg", sku: "A-10-V" })]);
    expect(content.productCategories).toContain("Recovery");
    expect(content.stockText[0].text).toBe("In stock");
    expect(content.embeddedDocuments[0]).toEqual(expect.objectContaining({ documentType: "PDF", url: "https://merchant.example/coa/alpha.pdf" }));
  });

  it("requires material context before visual objects or embedded text become findings", () => {
    const page = { url: productUrl, pageType: "PRODUCT" as const, content: extractNormalizedContent("<main><h1>Alpha</h1></main>", productUrl) };
    const asset: VisualAsset = { pageUrl: productUrl, pageType: "PRODUCT", kind: "PRODUCT_IMAGE", selector: "img", hash: "abc", storageKey: "scan/visual/abc.jpg", mimeType: "image/jpeg", bytes: new Uint8Array([1]) };
    const neutral = visualAnalysisSchema.parse({ observations: [{ assetIndex: 0, category: "DOSING_ADMINISTRATION", classification: "NEUTRAL", severity: "INFO", confidence: 0.98, visibleText: "10 mg", visualDescription: "A labeled laboratory vial and syringe are shown as technical equipment.", contextualExplanation: "No administration or consumer-use instruction is present.", materialContext: false, humanReviewRequired: false }] });
    expect(visualCandidates(page, [asset], neutral, "vision-test")).toEqual([]);
    const adverse = visualAnalysisSchema.parse({ observations: [{ assetIndex: 0, category: "WEIGHT_MANAGEMENT", classification: "ADVERSE", severity: "HIGH", confidence: 0.94, visibleText: "Transform your body", visualDescription: "Before-and-after body transformation paired with a purchase CTA.", contextualExplanation: "The product graphic directly presents a commercial physiological outcome.", materialContext: true, humanReviewRequired: true }] });
    expect(visualCandidates(page, [asset], adverse, "vision-test")).toEqual([expect.objectContaining({ ruleKey: "VISUAL-WEIGHT_MANAGEMENT", sourceKind: "VISUAL", assetHash: "abc", severity: "HIGH" })]);
  });

  it("accepts only exact, material PDF evidence and treats technical results as informational", () => {
    expect(extractDocumentMetadata("Laboratory: Acme Analytical | Compound: Alpha | Lot: LOT-42 | 2026-08-20 | Purity: 99.2%")).toEqual(expect.objectContaining({ laboratory: "Acme Analytical", compound: "Alpha", lotOrBatch: "LOT-42", purityOrResult: "99.2%", dates: ["2026-08-20"] }));
    const document: ExtractedDocument = { url: "https://merchant.example/coa/alpha.pdf", sourcePageUrl: productUrl, documentType: "COA", hash: "pdfhash", pageCount: 1, pages: [{ pageNumber: 1, text: "HPLC purity testing result 99.2%. Supports rapid weight loss." }], metadata: { dates: [], purityOrResult: "99.2%" } };
    const analysis = documentSemanticAnalysisSchema.parse({ observations: [
      { category: "LABORATORY_RESULT", classification: "INFORMATIONAL", severity: "INFO", confidence: 0.99, exactText: "HPLC purity testing result 99.2%.", pageNumber: 1, contextualExplanation: "Technical laboratory result.", humanReviewRequired: false },
      { category: "VISIBLE_CLAIM", classification: "ADVERSE", severity: "HIGH", confidence: 0.95, exactText: "Supports rapid weight loss.", pageNumber: 1, contextualExplanation: "The public certificate contains a physiological marketing claim.", humanReviewRequired: true },
      { category: "VISIBLE_CLAIM", classification: "ADVERSE", severity: "HIGH", confidence: 0.99, exactText: "Invented cure claim", pageNumber: 1, contextualExplanation: "Not present.", humanReviewRequired: true },
    ] });
    expect(documentCandidates(document, analysis, "document-test")).toEqual([expect.objectContaining({ detectedText: "Supports rapid weight loss.", sourceKind: "DOCUMENT" })]);
  });

  it("builds one evidence-graph theme with deduplicated adverse and mitigating evidence", () => {
    const finding: CandidateFinding = { ruleKey: "MKT-INTENDED-USE-001", severity: "HIGH", confidence: 0.94, status: "NEEDS_REVIEW", category: "Claims & intended use", title: "Weight positioning", description: "Observed", url: productUrl, pageType: "PRODUCT", detectedText: "Weight Loss Research Products", reason: "Commercial physiological category", recommendedAction: "Review", scoreComponent: "MARKETING_RISK", prominence: "PRIMARY_COMMERCIAL", evidenceClassification: "ADVERSE" };
    const graph = buildEvidenceGraph([finding, { ...finding, url: `${productUrl}&duplicate=1` }], [{ url: "https://merchant.example/", pageType: "HOME", text: "Not for human consumption." }], new Date("2026-08-24T00:00:00Z"));
    expect(graph.themes).toHaveLength(1);
    expect(graph.themes[0].evidence).toHaveLength(2);
    expect(graph.themes[0].mitigatingEvidence).toEqual([expect.objectContaining({ classification: "MITIGATING", quote: "Not for human consumption." })]);
  });

  it("weights product prominence above editorial references while keeping repetition capped", () => {
    const base: CandidateFinding = { ruleKey: "MKT-CLAIM-001", severity: "HIGH", confidence: 0.95, status: "NEEDS_REVIEW", category: "Marketing", title: "Claim", description: "Observed", url: productUrl, pageType: "PRODUCT", detectedText: "Supports muscle growth", reason: "Affirmative outcome", recommendedAction: "Review", scoreComponent: "MARKETING_RISK" };
    const product = calculateHealthScore([{ ...base, prominence: "PRIMARY_COMMERCIAL" }]);
    const article = calculateHealthScore([{ ...base, pageType: "ARTICLE", prominence: "EDITORIAL" }]);
    expect(product.components.find((item) => item.key === "MARKETING_RISK")!.score).toBeLessThan(article.components.find((item) => item.key === "MARKETING_RISK")!.score);
  });
});
