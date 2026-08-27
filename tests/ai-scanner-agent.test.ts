import { beforeEach, describe, expect, it, vi } from "vitest";
import { LunaAuditIncompleteError, LunaQuotaError, LunaRateLimitError, LunaTransportInterruptedError, LunaUnavailableError, parseRateLimitResetMs, parseRetryAfterMs, runLunaAudit, type LunaResumeCheckpoint, type LunaToolRuntime } from "@/ai-scanner/luna/agent";
import type { AuditCoverage, AuditUsage, ToolExecutionResult } from "@/ai-scanner/types";

function modelResponse(body: unknown) { return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }); }
function rateLimitResponse(body: unknown, headers: Record<string, string> = {}) { return new Response(JSON.stringify(body), { status: 429, headers: { "content-type": "application/json", ...headers } }); }

class FakeTools implements LunaToolRuntime {
  private calls: string[] = [];
  private usage: AuditUsage = { responseCalls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0, approximateCostUsd: 0 };
  constructor(readonly budget = { maximumRuntimeMs: 60_000, maximumToolCalls: 20, maximumTokens: 100_000, maximumCostUsd: 10 }) {}
  setUsage(usage: AuditUsage) { this.usage = usage; }
  budgetExceeded() { return false; }
  coverage(): AuditCoverage { return { urlsDiscovered: ["https://merchant.example/", "https://merchant.example/products/a"], firstPartyUrlsDiscovered: ["https://merchant.example/", "https://merchant.example/products/a"], firstPartyUrlsRemaining: [], siteInventoryInspected: true, pagesOpened: ["https://merchant.example/", "https://merchant.example/products/a"], pagesVisuallyReviewed: ["https://merchant.example/", "https://merchant.example/products/a"], visualRegionsInspected: 3, imagesInspected: 1, categoriesInspected: ["Catalog"], productsDiscovered: 1, productsVerified: 1, productPagesWithImagesInspected: ["https://merchant.example/products/a"], documentsInspected: [], policyPagesInspected: ["TERMS", "PRIVACY", "REFUND", "SHIPPING", "CONTACT"].map((type) => ({ type: type as "TERMS" | "PRIVACY" | "REFUND" | "SHIPPING" | "CONTACT", url: `https://merchant.example/${type.toLowerCase()}` })), publicAccessGatesDismissed: [], commerceSignalsObserved: true, checkoutStatesInspected: ["https://merchant.example/checkout"], checkoutFormsInspected: 1, totalLunaToolCalls: this.calls.length, auditRuntimeMs: 500, tokenUsage: this.usage }; }
  async execute(_callId: string, name: string): Promise<ToolExecutionResult> { this.calls.push(name); const id = `evidence-${this.calls.length}`; return { ok: true, evidenceIds: [id], imageEvidenceIds: [id], data: { url: "https://merchant.example/", raw: true } }; }
  async imageInputs(evidenceIds: string[]) { return evidenceIds.map((evidenceId) => ({ evidenceId, mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,AA==" })); }
  executedCalls() { return [...this.calls]; }
}

class RecoveringTools implements LunaToolRuntime {
  readonly budget = { maximumRuntimeMs: 60_000, maximumToolCalls: 20, maximumTokens: 100_000, maximumCostUsd: 10 };
  private calls: string[] = [];
  private opened = false;
  private usage: AuditUsage = { responseCalls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0, approximateCostUsd: 0 };
  setUsage(usage: AuditUsage) { this.usage = usage; }
  budgetExceeded() { return false; }
  coverage(): AuditCoverage {
    return {
      urlsDiscovered: this.opened ? ["https://merchant.example/"] : [],
      firstPartyUrlsDiscovered: this.opened ? ["https://merchant.example/"] : [],
      firstPartyUrlsRemaining: [],
      siteInventoryInspected: this.calls.length >= 3,
      pagesOpened: this.opened ? ["https://merchant.example/"] : [],
      pagesVisuallyReviewed: this.opened ? ["https://merchant.example/"] : [],
      visualRegionsInspected: this.opened ? 1 : 0,
      imagesInspected: 0,
      categoriesInspected: [],
      productsDiscovered: 0,
      productsVerified: 0,
      productPagesWithImagesInspected: [],
      documentsInspected: [],
      policyPagesInspected: this.calls.length >= 3 ? ["TERMS", "PRIVACY", "REFUND", "SHIPPING", "CONTACT"].map((type) => ({ type: type as "TERMS" | "PRIVACY" | "REFUND" | "SHIPPING" | "CONTACT", url: `https://merchant.example/${type.toLowerCase()}` })) : [],
      publicAccessGatesDismissed: [],
      commerceSignalsObserved: false,
      checkoutStatesInspected: [],
      checkoutFormsInspected: 0,
      totalLunaToolCalls: this.calls.length,
      auditRuntimeMs: 500,
      tokenUsage: this.usage,
    };
  }
  async execute(_callId: string, name: string): Promise<ToolExecutionResult> {
    this.calls.push(name);
    if (this.calls.length === 1) return { ok: false, evidenceIds: [], error: "Transient browser navigation failure" };
    this.opened = true;
    const id = `recovered-evidence-${this.calls.length}`;
    return { ok: true, evidenceIds: [id], imageEvidenceIds: [id], data: { url: "https://merchant.example/" } };
  }
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
    expect(String(requests[0].instructions)).toContain("canonical URL paths/slugs");
    expect(String(requests[0].instructions)).toContain("syringes, needles");
    expect(String(requests[0].instructions)).toContain("explicit, required age confirmation");
    expect(String(requests[0].instructions)).toContain("terms, privacy, shipping/delivery, refund/returns");
    expect(requests[0].context_management).toEqual([{ type: "compaction", compact_threshold: 200_000 }]);
  });

  it("continues from server-side compaction without replaying the pre-compaction transcript", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const responses = [
      { status: "completed", output: [{ type: "function_call", call_id: "call-1", name: "open_url", arguments: JSON.stringify({ url: "https://merchant.example/" }) }] },
      { status: "completed", output: [{ type: "compaction", id: "cmp-1", encrypted_content: "opaque-state" }, { type: "function_call", call_id: "call-2", name: "inspect_navigation", arguments: "{}" }] },
      { status: "completed", output: [{ type: "function_call", call_id: "call-3", name: "inspect_product", arguments: JSON.stringify({ url: "https://merchant.example/products/a" }) }] },
      { status: "completed", output_text: JSON.stringify({ summary: "Completed after compaction.", observations: [{ text: "Evidence remained available.", evidenceIds: ["evidence-3"] }], findings: [], limitations: [] }) },
    ];
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return modelResponse(responses.shift());
    });

    const result = await runLunaAudit({ scanId: "scan-compaction", merchantId: "merchant-1", merchantName: "Merchant", merchantUrl: "https://merchant.example/", tools: new FakeTools(), request: request as typeof fetch });

    expect(result.result.summary).toContain("after compaction");
    expect((requests[2].input as Array<Record<string, unknown>>)[0]).toMatchObject({ type: "compaction", id: "cmp-1", encrypted_content: "opaque-state" });
    expect(JSON.stringify(requests[2].input)).not.toContain("Open the merchant URL");
    expect(JSON.stringify(requests[2].input)).toContain("evidence-2");
  });

  it("requires bounded recovery when Luna tries to finalize after a failed initial page open", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const tools = new RecoveringTools();
    const responses = [
      modelResponse({ status: "completed", output: [{ type: "function_call", call_id: "call-1", name: "open_url", arguments: JSON.stringify({ url: "https://merchant.example/" }) }] }),
      modelResponse({ status: "completed", output_text: JSON.stringify({ summary: "The URL could not be opened.", observations: [], findings: [], limitations: ["No page evidence was available."] }) }),
      modelResponse({ status: "completed", output: [{ type: "function_call", call_id: "call-2", name: "open_url", arguments: JSON.stringify({ url: "https://merchant.example/" }) }] }),
      modelResponse({ status: "completed", output_text: JSON.stringify({ summary: "The page was opened after bounded recovery.", observations: [{ text: "Recovered rendered merchant evidence.", evidenceIds: ["recovered-evidence-2"] }], findings: [], limitations: [] }) }),
      modelResponse({ status: "completed", output: [{ type: "function_call", call_id: "call-3", name: "inspect_navigation", arguments: "{}" }] }),
      modelResponse({ status: "completed", output_text: JSON.stringify({ summary: "Recovered and completed the minimum investigation.", observations: [{ text: "Recovered rendered merchant evidence.", evidenceIds: ["recovered-evidence-2", "recovered-evidence-3"] }], findings: [], limitations: [] }) }),
    ];
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return responses.shift()!;
    });

    const result = await runLunaAudit({ scanId: "scan-browser-recovery", merchantId: "merchant-1", merchantName: "Merchant", merchantUrl: "https://merchant.example/", tools, request: request as typeof fetch });

    expect(result.result.summary).toContain("Recovered and completed");
    expect(tools.executedCalls()).toEqual(["open_url", "open_url", "inspect_navigation"]);
    expect(requests[2].tool_choice).toEqual({ type: "function", name: "open_url" });
    expect(JSON.stringify(requests[2].input)).toContain("Do not finalize yet");
    expect(JSON.stringify(requests[2].input)).toContain("Transient browser navigation failure");
  });

  it("reserves token headroom and forces a no-tools final audit before the global token ceiling", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const tools = new FakeTools({ maximumRuntimeMs: 300_000, maximumToolCalls: 20, maximumTokens: 120_000, maximumCostUsd: 10 });
    const responses = [
      modelResponse({ status: "completed", usage: { input_tokens: 50_000, output_tokens: 10_000 }, output: [{ type: "function_call", call_id: "call-1", name: "open_url", arguments: JSON.stringify({ url: "https://merchant.example/" }) }] }),
      modelResponse({ status: "completed", usage: { input_tokens: 52_000, output_tokens: 1_000 }, output_text: JSON.stringify({ summary: "Finalized before exhausting the cumulative token budget.", observations: [{ text: "Retained page evidence was assessed.", evidenceIds: ["evidence-1"] }], findings: [], limitations: ["Further surfaces were not inspected because finalization headroom was reserved."] }) }),
    ];
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return responses.shift()!;
    });

    const result = await runLunaAudit({
      scanId: "scan-finalization-reserve",
      merchantId: "merchant-1",
      merchantName: "Merchant",
      merchantUrl: "https://merchant.example/",
      tools,
      request: request as typeof fetch,
    });

    expect(result.result.summary).toContain("Finalized");
    expect(tools.executedCalls()).toEqual(["open_url"]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(requests[1].tool_choice).toBe("none");
    expect(requests[1].tools).toEqual([]);
    expect(requests[1].max_output_tokens).toBe(64_000);
    expect(JSON.stringify(requests[1].input)).toContain("Investigation is now closed");
    expect(JSON.stringify(requests[1].input)).toContain("evidence-1");
  });

  it("recovers an output-token-truncated turn by finalizing from completed evidence", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const tools = new FakeTools();
    const responses = [
      modelResponse({ status: "completed", usage: { input_tokens: 100, output_tokens: 20 }, output: [{ type: "function_call", call_id: "call-1", name: "open_url", arguments: JSON.stringify({ url: "https://merchant.example/" }) }] }),
      modelResponse({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage: { input_tokens: 200, output_tokens: 16_000 }, output: [] }),
      modelResponse({ status: "completed", usage: { input_tokens: 220, output_tokens: 500 }, output_text: JSON.stringify({ summary: "Recovered structured audit.", observations: [{ text: "The completed browser evidence was retained.", evidenceIds: ["evidence-1"] }], findings: [], limitations: [] }) }),
    ];
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return responses.shift()!;
    });

    const result = await runLunaAudit({
      scanId: "scan-output-recovery",
      merchantId: "merchant-1",
      merchantName: "Merchant",
      merchantUrl: "https://merchant.example/",
      tools,
      request: request as typeof fetch,
    });

    expect(result.result.summary).toBe("Recovered structured audit.");
    expect(tools.executedCalls()).toEqual(["open_url"]);
    expect(requests[2].tool_choice).toBe("none");
    expect(requests[2].tools).toEqual([]);
    expect(JSON.stringify(requests[2].input)).toContain("evidence-1");
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
    expect(waits).toEqual([5_625, 11_250]);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("uses OpenAI token-reset headers as the cooldown when Retry-After is absent", async () => {
    const waits: number[] = [];
    const responses = [
      rateLimitResponse(
        { error: { code: "rate_limit_exceeded", type: "rate_limit_error", message: "Token rate limit reached for TPM." } },
        { "x-ratelimit-remaining-tokens": "0", "x-ratelimit-reset-tokens": "1m30s" },
      ),
      modelResponse({ status: "completed", output_text: JSON.stringify({ summary: "Recovered after the server token reset.", observations: [], findings: [], limitations: [] }) }),
    ];
    const request = vi.fn(async () => responses.shift()!);

    const result = await runLunaAudit({
      scanId: "scan-reset-header",
      merchantId: "merchant-1",
      merchantName: "Merchant",
      merchantUrl: "https://merchant.example/",
      tools: new FakeTools({ maximumRuntimeMs: 300_000, maximumToolCalls: 20, maximumTokens: 100_000, maximumCostUsd: 10 }),
      request: request as typeof fetch,
      sleep: async (milliseconds) => { waits.push(milliseconds); },
      random: () => 0,
    });

    expect(result.result.summary).toContain("server token reset");
    expect(waits).toEqual([90_000]);
  });

  it("does not shorten a Retry-After value that exceeds the fallback backoff cap", async () => {
    const waits: number[] = [];
    const responses = [
      rateLimitResponse(
        { error: { code: "rate_limit_exceeded", type: "rate_limit_error", message: "Token rate limit reached for TPM." } },
        { "retry-after": "180", "x-ratelimit-remaining-tokens": "0" },
      ),
      modelResponse({ status: "completed", output_text: JSON.stringify({ summary: "Recovered after the full Retry-After cooldown.", observations: [], findings: [], limitations: [] }) }),
    ];
    const result = await runLunaAudit({
      scanId: "scan-long-retry-after",
      merchantId: "merchant-1",
      merchantName: "Merchant",
      merchantUrl: "https://merchant.example/",
      tools: new FakeTools({ maximumRuntimeMs: 300_000, maximumToolCalls: 20, maximumTokens: 100_000, maximumCostUsd: 10 }),
      request: vi.fn(async () => responses.shift()!) as typeof fetch,
      sleep: async (milliseconds) => { waits.push(milliseconds); },
      random: () => 0,
    });

    expect(result.result.summary).toContain("full Retry-After");
    expect(waits).toEqual([180_000]);
  });

  it("resumes a retained Luna conversation after the per-request TPM retry cap", async () => {
    const tools = new FakeTools({ maximumRuntimeMs: 600_000, maximumToolCalls: 20, maximumTokens: 100_000, maximumCostUsd: 10 });
    let checkpoint: LunaResumeCheckpoint | null = null;
    const firstResponses = [
      modelResponse({ status: "completed", output: [{ type: "function_call", call_id: "call-1", name: "open_url", arguments: JSON.stringify({ url: "https://merchant.example/" }) }] }),
      ...Array.from({ length: 6 }, () => rateLimitResponse(
        { error: { code: "rate_limit_exceeded", type: "rate_limit_error", message: "Token rate limit reached for TPM." } },
        { "retry-after": "0", "x-ratelimit-remaining-tokens": "0" },
      )),
    ];
    const firstRequest = vi.fn(async () => firstResponses.shift()!);

    const paused = await runLunaAudit({
      scanId: "scan-checkpoint-resume",
      merchantId: "merchant-1",
      merchantName: "Merchant",
      merchantUrl: "https://merchant.example/",
      tools,
      request: firstRequest as typeof fetch,
      sleep: async () => undefined,
      random: () => 0,
      onCheckpoint: async (value) => { checkpoint = value; },
    }).catch((error: unknown) => error);

    expect(paused).toBeInstanceOf(LunaRateLimitError);
    expect(checkpoint).not.toBeNull();
    expect(JSON.stringify(checkpoint)).toContain("evidence-1");
    expect(JSON.stringify(checkpoint)).toContain("orbit-evidence://evidence-1");

    const resumedBodies: string[] = [];
    const resumedResponses = [
      modelResponse({ status: "completed", output: [{ type: "function_call", call_id: "call-2", name: "inspect_navigation", arguments: "{}" }] }),
      modelResponse({ status: "completed", output: [{ type: "function_call", call_id: "call-3", name: "inspect_product", arguments: JSON.stringify({ url: "https://merchant.example/products/a" }) }] }),
      modelResponse({ status: "completed", output_text: JSON.stringify({ summary: "Resumed without restarting completed browser work.", observations: [{ text: "Retained evidence remained in context.", evidenceIds: ["evidence-1"] }], findings: [], limitations: [] }) }),
    ];
    const resumedRequest = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      resumedBodies.push(String(init?.body));
      return resumedResponses.shift()!;
    });
    const resumed = await runLunaAudit({
      scanId: "scan-checkpoint-resume",
      merchantId: "merchant-1",
      merchantName: "Merchant",
      merchantUrl: "https://merchant.example/",
      tools,
      request: resumedRequest as typeof fetch,
      sleep: async () => undefined,
      random: () => 0,
      resumeCheckpoint: checkpoint,
    });

    expect(resumed.result.summary).toContain("without restarting");
    expect(tools.executedCalls()).toEqual(["open_url", "inspect_navigation", "inspect_product"]);
    expect(resumedBodies[0]).toContain("data:image/jpeg;base64,AA==");
    expect(resumedBodies[0]).toContain("evidence-1");
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

    const error = await attempt.catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      name: "LunaRateLimitError",
      kind: "TOKENS_PER_MINUTE",
      retries: 5,
    });
    expect(error).toBeInstanceOf(LunaRateLimitError);
    expect(error).toBeInstanceOf(LunaAuditIncompleteError);
    expect(error).not.toBeInstanceOf(LunaUnavailableError);
    expect(request).toHaveBeenCalledTimes(6);
  });

  it("turns repeated request aborts into a checkpoint-backed manual continuation", async () => {
    let checkpoint: LunaResumeCheckpoint | null = null;
    const abort = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    const request = vi.fn(async () => { throw abort; });

    const error = await runLunaAudit({
      scanId: "scan-aborted",
      merchantId: "merchant-1",
      merchantName: "Merchant",
      merchantUrl: "https://merchant.example/",
      tools: new FakeTools(),
      request: request as typeof fetch,
      onCheckpoint: async (value) => { checkpoint = value; },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LunaTransportInterruptedError);
    expect(error).toBeInstanceOf(LunaAuditIncompleteError);
    expect(error).not.toBeInstanceOf(LunaUnavailableError);
    expect(error).toMatchObject({ retries: 3, timedOut: true });
    expect(checkpoint).not.toBeNull();
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("parses Retry-After seconds and HTTP dates as minimum cooldowns", () => {
    expect(parseRetryAfterMs("1.5", 0)).toBe(1_500);
    expect(parseRetryAfterMs("Thu, 01 Jan 1970 00:00:03 GMT", 1_000)).toBe(2_000);
    expect(parseRetryAfterMs("not-a-delay", 0)).toBeNull();
  });

  it("parses OpenAI reset duration headers", () => {
    expect(parseRateLimitResetMs("1m30s")).toBe(90_000);
    expect(parseRateLimitResetMs("250ms")).toBe(250);
    expect(parseRateLimitResetMs("2.5")).toBe(2_500);
    expect(parseRateLimitResetMs("later")).toBeNull();
  });
});
