import { beforeEach, describe, expect, it, vi } from "vitest";
import { runLunaAudit, type LunaToolRuntime } from "@/ai-scanner/luna/agent";
import type { AuditCoverage, AuditUsage, ToolExecutionResult } from "@/ai-scanner/types";

function modelResponse(body: unknown) { return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }); }

class FakeTools implements LunaToolRuntime {
  readonly budget = { maximumRuntimeMs: 60_000, maximumToolCalls: 20, maximumTokens: 100_000, maximumCostUsd: 10 };
  private calls: string[] = [];
  private usage: AuditUsage = { responseCalls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0, approximateCostUsd: 0 };
  setUsage(usage: AuditUsage) { this.usage = usage; }
  budgetExceeded() { return false; }
  coverage(): AuditCoverage { return { urlsDiscovered: ["https://merchant.example/", "https://merchant.example/products/a"], pagesOpened: ["https://merchant.example/", "https://merchant.example/products/a"], pagesVisuallyReviewed: ["https://merchant.example/", "https://merchant.example/products/a"], visualRegionsInspected: 3, imagesInspected: 1, categoriesInspected: ["Catalog"], productsDiscovered: 1, productsVerified: 1, documentsInspected: [], checkoutStatesInspected: [], totalLunaToolCalls: this.calls.length, auditRuntimeMs: 500, tokenUsage: this.usage }; }
  async execute(_callId: string, name: string): Promise<ToolExecutionResult> { this.calls.push(name); const id = `evidence-${this.calls.length}`; return { ok: true, evidenceIds: [id], imageEvidenceIds: [id], data: { url: "https://merchant.example/", raw: true } }; }
  async imageInputs(evidenceIds: string[]) { return evidenceIds.map((evidenceId) => ({ evidenceId, mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,AA==" })); }
}

describe("Luna-first audit loop", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key-not-secret";
    process.env.AI_SCANNER_MODEL = "gpt-5.6-luna";
  });

  it("starts from the merchant URL, lets Luna choose follow-ups, sends pixels, and returns strict findings", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const responses = [
      { status: "completed", usage: { input_tokens: 100, output_tokens: 20 }, output: [{ type: "function_call", call_id: "call-1", name: "open_url", arguments: JSON.stringify({ url: "https://merchant.example/" }) }] },
      { status: "completed", usage: { input_tokens: 150, output_tokens: 25 }, output: [{ type: "function_call", call_id: "call-2", name: "inspect_navigation", arguments: "{}" }] },
      { status: "completed", usage: { input_tokens: 180, output_tokens: 30 }, output: [{ type: "function_call", call_id: "call-3", name: "inspect_product", arguments: JSON.stringify({ url: "https://merchant.example/products/a" }) }] },
      { status: "completed", usage: { input_tokens: 200, output_tokens: 80 }, output_text: JSON.stringify({ summary: "Luna inspected the rendered storefront and a product.", observations: [{ text: "The homepage and product were visually reviewed.", evidenceIds: ["evidence-1", "evidence-3"] }], findings: [{ title: "Material representation requires review", severity: "HIGH", confidence: 0.82, theme: "Commercial representation", category: "Merchandising", materiality: "MATERIAL", materialityWeight: 0.9, commercialProminence: 0.8, visualProminence: 0.7, productAssociation: true, mitigation: 0.2, ambiguous: false, contradictoryEvidence: false, explanation: "The cited rendered composition contains the representation.", affectedUrl: "https://merchant.example/products/a", contentType: "product", affectedProduct: "Product A", affectedCategory: "Catalog", verifiedSku: null, adverseEvidence: [{ evidenceId: "evidence-3", rationale: null }], mitigatingEvidence: [], neutralEvidence: [{ evidenceId: "evidence-1", rationale: "Homepage context" }], screenshotEvidenceIds: ["evidence-3"], remediation: "Revise the representation on Product A while preserving the observed context." }], limitations: ["Authenticated areas were not available."] }) },
    ];
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => { requests.push(JSON.parse(String(init?.body))); return modelResponse(responses.shift()); });
    const result = await runLunaAudit({ scanId: "scan-1", merchantId: "merchant-1", merchantName: "Merchant", merchantUrl: "https://merchant.example/", tools: new FakeTools(), request: request as typeof fetch });
    expect(result.result.findings).toHaveLength(1);
    expect(result.result.findings[0].verifiedSku).toBeNull();
    expect(result.usage.totalTokens).toBe(785);
    expect(requests[0].model).toBe("gpt-5.6-luna");
    expect(JSON.stringify(requests[0].input)).toContain("https://merchant.example/");
    expect(JSON.stringify(requests[0].input)).not.toContain("Material representation requires review");
    expect(JSON.stringify(requests[1].input)).toContain("input_image");
  });
});
