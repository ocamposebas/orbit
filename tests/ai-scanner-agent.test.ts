import { beforeEach, describe, expect, it, vi } from "vitest";
import { LunaQuotaError, LunaRateLimitError, parseRetryAfterMs, runLunaAudit, type LunaToolRuntime } from "@/ai-scanner/luna/agent";
import type { AuditCoverage, AuditUsage, ToolExecutionResult } from "@/ai-scanner/types";

function modelResponse(body: unknown) { return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }); }
function rateLimitResponse(body: unknown, headers: Record<string, string> = {}) { return new Response(JSON.stringify(body), { status: 429, headers: { "content-type": "application/json", ...headers } }); }

class FakeTools implements LunaToolRuntime {
  readonly budget = { maximumRuntimeMs: 60_000, maximumToolCalls: 20, maximumTokens: 100_000, maximumCostUsd: 10 };
  private calls: string[] = [];
  private usage: AuditUsage = { responseCalls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0, approximateCostUsd: 0 };
  setUsage(usage: AuditUsage) { this.usage = usage; }
  budgetExceeded() { return false; }
  coverage(): AuditCoverage { return { urlsDiscovered: ["https://merchant.example/", "https://merchant.example/products/a"], pagesOpened: ["https://merchant.example/", "https://merchant.example/products/a"], pagesVisuallyReviewed: ["https://merchant.example/", "https://merchant.example/products/a"], visualRegionsInspected: 3, imagesInspected: 1, categoriesInspected: ["Catalog"], productsDiscovered: 1, productsVerified: 1, documentsInspected: [], checkoutStatesInspected: [], totalLunaToolCalls: this.calls.length, auditRuntimeMs: 500, tokenUsage: this.usage }; }
  async execute(_callId: string, name: string): Promise<ToolExecutionResult> { this.calls.push(name); const id = `evidence-${this.calls.length}`; return { ok: true, evidenceIds: [id], imageEvidenceIds: [id], data: { url: "https://merchant.example/", raw: true } }; }
  async imageInputs(evidenceIds: string[]) { return evidenceIds.map((evidenceId) => ({ evidenceId, mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,AA==" })); }
  executedCalls() { return [...this.calls]; }
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

  it("retries only a TPM-throttled Luna turn, respects Retry-After, and preserves completed tool work", async () => {
    const tools = new FakeTools();
    const bodies: string[] = [];
    const waits: number[] = [];
    const responses = [
      modelResponse({ status: "completed", output: [{ type: "function_call", call_id: "call-1", name: "open_url", arguments: JSON.stringify({ url: "https://merchant.example/" }) }] }),
      rateLimitResponse({ error: { code: "rate_limit_exceeded", type: "rate_limit_error", message: "Token rate limit reached for tokens per min (TPM)." } }, { "retry-after": "2", "x-ratelimit-remaining-tokens": "0", "x-request-id": "req_tpm_test" }),
      modelResponse({ status: "completed", output: [{ type: "function_call", call_id: "call-2", name: "inspect_navigation", arguments: "{}" }] }),
      modelResponse({ status: "completed", output: [{ type: "function_call", call_id: "call-3", name: "inspect_product", arguments: JSON.stringify({ url: "https://merchant.example/products/a" }) }] }),
      modelResponse({ status: "completed", output_text: JSON.stringify({ summary: "Recovered after a temporary TPM cooldown.", observations: [{ text: "The retained storefront evidence remained available.", evidenceIds: ["evidence-1"] }], findings: [], limitations: [] }) }),
    ];
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return responses.shift()!;
    });

    const result = await runLunaAudit({
      scanId: "scan-rate-limit",
      merchantId: "merchant-1",
      merchantName: "Merchant",
      merchantUrl: "https://merchant.example/",
      tools,
      request: request as typeof fetch,
      sleep: async (milliseconds) => { waits.push(milliseconds); },
      random: () => 0,
    });

    expect(result.result.summary).toContain("Recovered");
    expect(waits).toEqual([2_000]);
    expect(bodies[1]).toBe(bodies[2]);
    expect(tools.executedCalls()).toEqual(["open_url", "inspect_navigation", "inspect_product"]);
    expect(request).toHaveBeenCalledTimes(5);
  });

  it("does not retry credit, billing, spend, or quota failures disguised as HTTP 429", async () => {
    const tools = new FakeTools();
    const request = vi.fn(async () => rateLimitResponse({ error: { code: "credit_balance_exhausted", type: "insufficient_quota", message: "Credit balance exhausted." } }));

    await expect(runLunaAudit({
      scanId: "scan-quota",
      merchantId: "merchant-1",
      merchantName: "Merchant",
      merchantUrl: "https://merchant.example/",
      tools,
      request: request as typeof fetch,
      sleep: async () => undefined,
      random: () => 0,
    })).rejects.toBeInstanceOf(LunaQuotaError);

    expect(request).toHaveBeenCalledOnce();
    expect(tools.executedCalls()).toEqual([]);
  });

  it("uses capped exponential backoff with jitter when Retry-After is absent", async () => {
    const waits: number[] = [];
    const responses = [
      rateLimitResponse({ error: { code: "rate_limit_exceeded", type: "rate_limit_error", message: "Rate limit reached." } }),
      rateLimitResponse({ error: { code: "rate_limit_exceeded", type: "rate_limit_error", message: "Rate limit reached." } }),
      modelResponse({ status: "completed", output_text: JSON.stringify({ summary: "Recovered after fallback backoff.", observations: [], findings: [], limitations: [] }) }),
    ];
    const request = vi.fn(async () => responses.shift()!);

    const result = await runLunaAudit({
      scanId: "scan-backoff",
      merchantId: "merchant-1",
      merchantName: "Merchant",
      merchantUrl: "https://merchant.example/",
      tools: new FakeTools(),
      request: request as typeof fetch,
      sleep: async (milliseconds) => { waits.push(milliseconds); },
      random: () => 0.5,
    });

    expect(result.result.summary).toContain("Recovered");
    expect(waits).toEqual([1_125, 2_250]);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("caps temporary rate-limit retries per Luna request and leaves the scan incomplete, not unavailable", async () => {
    const request = vi.fn(async () => rateLimitResponse(
      { error: { code: "rate_limit_exceeded", type: "rate_limit_error", message: "Token rate limit reached for TPM." } },
      { "retry-after": "0", "x-ratelimit-remaining-tokens": "0" },
    ));

    const attempt = runLunaAudit({
      scanId: "scan-retry-cap",
      merchantId: "merchant-1",
      merchantName: "Merchant",
      merchantUrl: "https://merchant.example/",
      tools: new FakeTools(),
      request: request as typeof fetch,
      sleep: async () => undefined,
      random: () => 0,
    });

    await expect(attempt).rejects.toMatchObject({
      name: "LunaRateLimitError",
      kind: "TOKENS_PER_MINUTE",
      retries: 5,
    });
    await expect(attempt).rejects.toBeInstanceOf(LunaRateLimitError);
    expect(request).toHaveBeenCalledTimes(6);
  });

  it("parses Retry-After seconds and HTTP dates as minimum cooldowns", () => {
    expect(parseRetryAfterMs("1.5", 0)).toBe(1_500);
    expect(parseRetryAfterMs("Thu, 01 Jan 1970 00:00:03 GMT", 1_000)).toBe(2_000);
    expect(parseRetryAfterMs("not-a-delay", 0)).toBeNull();
  });
});
