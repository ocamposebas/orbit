import { describe, expect, it, vi } from "vitest";
import { extractNormalizedContent } from "@/sentinel/extraction/extract";
import { evidenceManifestSchema, type EvidenceManifest } from "@/sentinel/evidence/schema";
import { lunaAuditToolDefinitions, LunaAuditWorkspace, type AuditPage } from "@/sentinel/agent/tools";
import { runLunaAgentLoop } from "@/sentinel/agent/orchestrator";
import { verifiedProductRecords } from "@/sentinel/verification/products";
import { lunaMerchantReviewSchema } from "@/sentinel/review/schema";

function page(url: string, html: string, pageType: AuditPage["pageType"] = "OTHER"): AuditPage {
  return { url, canonicalUrl: url, httpStatus: 200, pageType, content: extractNormalizedContent(html, url) };
}

function record(input: Partial<EvidenceManifest["records"][number]> & Pick<EvidenceManifest["records"][number], "id" | "artifactId" | "sourceUrl" | "evidenceType">): EvidenceManifest["records"][number] {
  return { scope: "MERCHANT_SITE", artifactKind: "PAGE_SNAPSHOT", sourceHash: `source-${input.id}`, artifactHash: `artifact-${input.artifactId}`, ...input };
}

function manifest(records: EvidenceManifest["records"]): EvidenceManifest {
  return evidenceManifestSchema.parse({ version: "orbit-evidence-manifest-v1", scanId: "scan-agent", generatedAt: "2026-08-25T12:00:00.000Z", records });
}

const budget = { maxAuditTimeMs: 30_000, maxToolCalls: 8, maxPages: 10, maxImageRegions: 1, maxDocuments: 3, maxTokens: 20_000, maxCostUsd: 10 };

describe("global agentic merchant scanner", () => {
  it("verifies products from platform-neutral commerce evidence and excludes editorial/SaaS surfaces", () => {
    const apparel = page("https://apparel.test/catalog/blue-shirt", `<main><h1>Blue shirt</h1><p>$39.00</p><select name="variant"><option data-sku="SHIRT-BLU-S">Small</option></select><button>Buy now</button></main>`);
    const equipment = page("https://industrial.test/equipment/lathe-a", `<script type="application/ld+json">{"@type":"Product","name":"Lathe A","sku":"LATHE-A","offers":{"price":"4200"}}</script><main><h1>Lathe A</h1><p>$4,200</p></main>`);
    const software = page("https://software.test/pricing", `<main><h1>Team plan</h1><p>$49 monthly</p><a href="/signup">Get started</a></main>`, "LANDING");
    const article = page("https://apparel.test/insights/blue-shirt", `<script type="application/ld+json">{"@type":"Product","name":"Blue shirt guide","offers":{"price":"39"}}</script><article><h1>Blue shirt guide</h1><button>Buy now</button></article>`, "ARTICLE");
    const products = verifiedProductRecords([apparel, equipment, software, article]);
    expect(products.map((product) => product.name)).toEqual(["Blue shirt", "Lathe A"]);
    expect(products[0]).toMatchObject({ sku: "SHIRT-BLU-S", signals: expect.arrayContaining(["COMMERCE_CTA", "PRICE", "VARIANT_CONTROL"]) });
    expect(products[1]).toMatchObject({ sku: "LATHE-A", signals: expect.arrayContaining(["PRODUCT_STRUCTURED_DATA", "SKU"]) });
  });

  it("exposes the requested generic tools and preserves a visual composition instead of isolated OCR", async () => {
    const product = page("https://homewares.test/item/lamp", `<main><h1>Desk lamp</h1><p>$55</p><button>Buy now</button><img src="https://homewares.test/lamp.jpg" alt="Lamp on a desk"></main>`, "PRODUCT");
    const evidence = manifest([
      record({ id: "type", artifactId: "page", sourceUrl: product.url, evidenceType: "PAGE_TYPE", value: "PRODUCT" }),
      record({ id: "name", artifactId: "page", sourceUrl: product.url, evidenceType: "PRODUCT_NAME", exactText: "Desk lamp" }),
      record({ id: "price", artifactId: "page", sourceUrl: product.url, evidenceType: "PRICE", exactText: "$55" }),
      record({ id: "cta", artifactId: "page", sourceUrl: product.url, evidenceType: "LINK_CTA", exactText: "Buy now", selector: "button" }),
      record({ id: "visual-1", artifactId: "shot-1", sourceUrl: product.url, artifactKind: "SCREENSHOT", evidenceType: "VIEWPORT", storageKey: "scan/visual/one.jpg", value: { visibleText: "Desk lamp $55 Buy now", surroundingDom: [{ selector: "main", text: "Desk lamp" }] } }),
      record({ id: "visual-2", artifactId: "shot-2", sourceUrl: product.url, artifactKind: "SCREENSHOT", evidenceType: "PRODUCT_IMAGE", storageKey: "scan/visual/two.jpg" }),
    ]);
    const workspace = new LunaAuditWorkspace([product], evidence, { ...budget, maxImageRegions: 3 });
    const result = await workspace.execute("call-visual", "inspect_visual_composition", { url: product.url, query: null, limit: 10 });
    expect(lunaAuditToolDefinitions.map((tool) => tool.name)).toEqual(expect.arrayContaining(["discover_urls", "open_rendered_page", "inspect_dom_structure", "enumerate_products", "inspect_visual_composition", "inspect_documents", "inspect_public_api", "inspect_read_only_checkout"]));
    expect(result).toMatchObject({ ok: true, data: { pageUrl: product.url, visibleText: expect.stringContaining("Desk lamp"), linksAndCtas: expect.any(Array), associatedProducts: expect.any(Array), semanticInstruction: expect.stringContaining("one composition") } });
    expect(workspace.trace().coverage.visual).toEqual({ discovered: 2, inspected: 2, percent: 100, complete: true, capped: false });
  });

  it("reports partial visual coverage when the image-region budget is reached", async () => {
    const product = page("https://outdoors.test/gear/tent", `<main><h1>Trail tent</h1><p>$199</p><button>Add to cart</button></main>`, "PRODUCT");
    const evidence = manifest([
      record({ id: "shot-a", artifactId: "visual-a", sourceUrl: product.url, artifactKind: "SCREENSHOT", evidenceType: "VIEWPORT", storageKey: "a.jpg" }),
      record({ id: "shot-b", artifactId: "visual-b", sourceUrl: product.url, artifactKind: "SCREENSHOT", evidenceType: "FULL_PAGE", storageKey: "b.jpg" }),
    ]);
    const workspace = new LunaAuditWorkspace([product], evidence, { ...budget, maxImageRegions: 1 });
    await workspace.execute("call-a", "inspect_image_region", { url: product.url, query: "VIEWPORT", limit: 1 });
    const blocked = await workspace.execute("call-b", "inspect_image_region", { url: product.url, query: "FULL_PAGE", limit: 1 });
    expect(blocked).toMatchObject({ ok: false, budgetExhausted: true });
    expect(workspace.trace().coverage.visual).toEqual({ discovered: 2, inspected: 1, percent: 50, complete: false, capped: true });
  });

  it("makes Luna record a plan and iteratively call merchant tools before stopping", async () => {
    const item = page("https://books.test/title/orbit", `<main><h1>Orbit</h1><p>$18</p><button>Buy now</button></main>`);
    const evidence = manifest([
      record({ id: "page-type", artifactId: "page", sourceUrl: item.url, evidenceType: "PAGE_TYPE", value: "OTHER" }),
      record({ id: "product-name", artifactId: "page", sourceUrl: item.url, evidenceType: "PRODUCT_NAME", exactText: "Orbit" }),
      record({ id: "product-price", artifactId: "page", sourceUrl: item.url, evidenceType: "PRICE", exactText: "$18" }),
      record({ id: "product-cta", artifactId: "page", sourceUrl: item.url, evidenceType: "LINK_CTA", exactText: "Buy now" }),
    ]);
    const responses = [
      { id: "response-plan", status: "completed", output: [{ type: "function_call", call_id: "plan", name: "record_investigation_plan", arguments: JSON.stringify({ objective: "Audit the discovered books merchant", steps: ["Verify the catalog", "Inspect commercial context"], priorities: ["Product identity"] }) }], usage: { input_tokens: 100, output_tokens: 20 } },
      { id: "response-tools", status: "completed", output: [{ type: "function_call", call_id: "products", name: "enumerate_products", arguments: JSON.stringify({ url: null, query: null, limit: 20 }) }, { type: "function_call", call_id: "text", name: "inspect_visible_text", arguments: JSON.stringify({ url: item.url, query: null, limit: 20 }) }], usage: { input_tokens: 120, output_tokens: 30 } },
      { id: "response-done", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Investigation complete." }] }], usage: { input_tokens: 80, output_tokens: 10 } },
    ];
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(responses.shift()), { status: 200, headers: { "content-type": "application/json" } }));
    const workspace = new LunaAuditWorkspace([item], evidence, budget);
    const result = await runLunaAgentLoop({ scanId: "scan-agent", merchantId: "merchant-books", merchantName: "Books", merchantDescription: "Online bookseller", workspace, config: { apiKey: "test", baseUrl: "https://api.openai.test/v1", model: "gpt-5.6-luna", reasoningEffort: "high", timeoutMs: 5_000, maxOutputTokens: 2_000 }, request });
    expect(result.trace.plan).toMatchObject({ objective: "Audit the discovered books merchant" });
    expect(result.trace.toolCalls.map((call) => call.tool)).toEqual(["record_investigation_plan", "enumerate_products", "inspect_visible_text"]);
    expect(result.trace.evidenceInspected).toEqual(expect.arrayContaining(["product-name", "product-price", "product-cta"]));
    expect(request).toHaveBeenCalledTimes(3);
    const firstBody = JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(firstBody.tool_choice).toEqual({ type: "function", name: "record_investigation_plan" });
    expect(firstBody.store).toBe(false);
    expect(firstBody.include).toContain("reasoning.encrypted_content");
  });

  it("supports non-health merchant risk themes and validated contextual score inputs", () => {
    const parsed = lunaMerchantReviewSchema.parse({
      version: "orbit-luna-review-v1",
      merchantSummary: { businessModel: "Consumer electronics marketplace", overallContext: "Products and checkout were inspected together.", evidenceRecordIds: ["claim"] },
      observations: [{ issueKey: "authenticity", domain: "SEMANTIC_CONTEXT", category: "Product authenticity", riskTheme: "COUNTERFEIT_AUTHENTICITY", classification: "ADVERSE", conclusion: "The product page makes an unsupported authenticity representation.", confidence: 0.93, materiality: "MATERIAL", proposedSeverity: "HIGH", commercialProminence: "HIGH", productAssociation: "DIRECT", visualSignificance: "SUPPORTING", mitigation: "NONE", remediation: "On the affected product URL, remove the unsupported authenticity badge or add verifiable first-party provenance beside the purchase CTA.", humanReviewRequired: true, evidence: [{ evidenceRecordId: "claim", role: "PRIMARY", classification: "ADVERSE", rationale: "The badge and CTA appear in one commercial composition." }], externalVerificationRequest: null }],
      uncertainties: [],
    });
    expect(parsed.observations[0]).toMatchObject({ riskTheme: "COUNTERFEIT_AUTHENTICITY", commercialProminence: "HIGH", productAssociation: "DIRECT", remediation: expect.stringContaining("affected product URL") });
  });
});
