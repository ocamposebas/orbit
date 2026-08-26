import { describe, expect, it, vi } from "vitest";
import type { CandidateFinding } from "@/sentinel/types";
import { extractNormalizedContent } from "@/sentinel/extraction/extract";
import { evidenceManifestSchema } from "@/sentinel/evidence/schema";
import { LunaAuditWorkspace, type AuditPage } from "@/sentinel/agent/tools";
import { runLunaAgentLoop } from "@/sentinel/agent/orchestrator";
import { runAgenticTransition, selectAgenticRuntime } from "@/sentinel/agent/runtime";
import { assertAgenticPrimaryInvariant, candidatesForPrimaryReview, runAnalysisStage } from "@/sentinel/pipeline/analysis-stage";
import { createAnalysisJobHandler, productionAnalysisStage } from "@/workers/analysis-handler";
import { pipelineVersion } from "@/sentinel/queue";
import { logger } from "@/sentinel/logger";

const enabled = selectAgenticRuntime({ AI_PROVIDER: "openai-compatible", AI_REVIEW_MODEL: "gpt-5.6-luna", AI_API_KEY: "test-key", DUAL_REVIEW_MODE: "enforced" });
const budget = { maxAuditTimeMs: 30_000, maxToolCalls: 8, maxPages: 10, maxImageRegions: 2, maxDocuments: 2, maxTokens: 20_000, maxCostUsd: 10 };

function merchantEvidence() {
  const url = "https://merchant.test/catalog/widget";
  const page: AuditPage = { url, canonicalUrl: url, httpStatus: 200, pageType: "PRODUCT", content: extractNormalizedContent("<main><h1>Widget</h1><p>$25</p><button>Add to cart</button></main>", url) };
  const manifest = evidenceManifestSchema.parse({
    version: "orbit-evidence-manifest-v1",
    scanId: "scan-production",
    generatedAt: "2026-08-25T12:00:00.000Z",
    records: [
      { id: "page", scope: "MERCHANT_SITE", artifactId: "page", artifactKind: "PAGE_SNAPSHOT", sourceUrl: url, sourceHash: "source-page", artifactHash: "artifact-page", evidenceType: "PAGE_TYPE", value: "PRODUCT" },
      { id: "name", scope: "MERCHANT_SITE", artifactId: "page", artifactKind: "PAGE_SNAPSHOT", sourceUrl: url, sourceHash: "source-name", artifactHash: "artifact-name", evidenceType: "PRODUCT_NAME", exactText: "Widget" },
      { id: "price", scope: "MERCHANT_SITE", artifactId: "page", artifactKind: "PAGE_SNAPSHOT", sourceUrl: url, sourceHash: "source-price", artifactHash: "artifact-price", evidenceType: "PRICE", exactText: "$25" },
    ],
  });
  return { page, manifest };
}

describe("agentic production execution path", () => {
  it("invokes the orchestrator in enforced mode, creates a plan, and executes a merchant evidence tool", async () => {
    const { page, manifest } = merchantEvidence();
    const responses = [
      { status: "completed", output: [{ type: "function_call", call_id: "plan", name: "record_investigation_plan", arguments: JSON.stringify({ objective: "Audit the merchant", steps: ["Inspect products"], priorities: ["Commerce"] }) }], usage: { input_tokens: 10, output_tokens: 5 } },
      { status: "completed", output: [{ type: "function_call", call_id: "products", name: "enumerate_products", arguments: JSON.stringify({ url: null, query: null, limit: 10 }) }], usage: { input_tokens: 12, output_tokens: 4 } },
      { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Done" }] }], usage: { input_tokens: 8, output_tokens: 2 } },
    ];
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(responses.shift()), { status: 200 }));
    const workspace = new LunaAuditWorkspace([page], manifest, budget);
    const invoke = vi.fn(() => runLunaAgentLoop({ scanId: "scan-production", merchantId: "merchant", merchantName: "Merchant", merchantDescription: "Store", workspace, config: { apiKey: "test-key", baseUrl: "https://api.openai.test/v1", model: "gpt-5.6-luna", reasoningEffort: "high", timeoutMs: 5_000, maxOutputTokens: 2_000 }, request }));
    const transition = await runAgenticTransition({ scanId: "scan-production", selection: enabled, invoke });

    expect(transition.status).toBe("COMPLETED");
    expect(invoke).toHaveBeenCalledOnce();
    expect(transition.result?.trace.plan?.objective).toBe("Audit the merchant");
    expect(transition.result?.trace.toolCalls.map((call) => call.tool)).toEqual(["record_investigation_plan", "enumerate_products"]);
  });

  it("never keeps local semantic candidates as primary findings in enforced mode", () => {
    const base: CandidateFinding = { ruleKey: "SEM-LOCAL-001", severity: "HIGH", confidence: 0.95, status: "NEEDS_REVIEW", category: "Marketing", title: "Legacy semantic", description: "Legacy", url: "https://merchant.test", pageType: "HOME", reason: "Legacy", recommendedAction: "Review", scoreComponent: "MARKETING_RISK", analysisSource: "SEMANTIC_PAGE", modelVersion: "local-semantic-v5" };
    const objective: CandidateFinding = { ...base, ruleKey: "SITE-HOME-001", title: "Homepage unavailable", analysisSource: "DETERMINISTIC", scoreComponent: "SITE_CONTROLS" };
    expect(candidatesForPrimaryReview("enforced", [base, objective])).toEqual([objective]);
    expect(candidatesForPrimaryReview("shadow", [base, objective])).toEqual([base, objective]);
    expect(() => assertAgenticPrimaryInvariant("enforced", true, [base])).toThrow(/Agentic primary invariant violated/);
    expect(() => assertAgenticPrimaryInvariant("shadow", true, [base])).not.toThrow();
  });

  it("logs and returns the exact sanitized OpenAI startup failure", async () => {
    const errorLog = vi.spyOn(logger, "error");
    const { page, manifest } = merchantEvidence();
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Model access denied", code: "model_not_found", type: "invalid_request_error" } }), { status: 404, headers: { "x-request-id": "req_agent_123" } }));
    const workspace = new LunaAuditWorkspace([page], manifest, budget);
    const transition = await runAgenticTransition({ scanId: "scan-production", selection: enabled, invoke: () => runLunaAgentLoop({ scanId: "scan-production", merchantId: "merchant", merchantName: "Merchant", merchantDescription: "Store", workspace, config: { apiKey: "test-key", baseUrl: "https://api.openai.test/v1", model: "gpt-5.6-luna", reasoningEffort: "high", timeoutMs: 5_000, maxOutputTokens: 2_000 }, request }) });

    expect(transition.status).toBe("AGENTIC_REVIEW_FAILED");
    expect(transition.failure).toMatchObject({ errorName: "LunaAgentRequestError", message: "Model access denied", httpStatus: 404, openaiRequestId: "req_agent_123", openaiCode: "model_not_found", openaiType: "invalid_request_error", agentStage: "agent_request", toolName: null });
    expect(transition.failure?.stack).toContain("LunaAgentRequestError");
    expect(errorLog).toHaveBeenCalledWith(expect.objectContaining({ agenticFailure: expect.objectContaining({ openaiRequestId: "req_agent_123" }), fallbackReason: null }), "Agentic Sentinel failed; fallback prohibited in enforced mode");
    errorLog.mockRestore();
  });

  it("allows fallback only when off or shadow mode explicitly selects it", async () => {
    const enforcedMissingKey = selectAgenticRuntime({ AI_PROVIDER: "openai-compatible", AI_REVIEW_MODEL: "gpt-5.6-luna", AI_API_KEY: undefined, DUAL_REVIEW_MODE: "enforced" });
    const shadowMissingKey = selectAgenticRuntime({ AI_PROVIDER: "openai-compatible", AI_REVIEW_MODEL: "gpt-5.6-luna", AI_API_KEY: undefined, DUAL_REVIEW_MODE: "shadow" });
    await expect(runAgenticTransition({ scanId: "enforced", selection: enforcedMissingKey })).resolves.toMatchObject({ status: "AGENTIC_REVIEW_FAILED", failure: { agentStage: "configuration", message: expect.stringContaining("AI_API_KEY_MISSING") } });
    await expect(runAgenticTransition({ scanId: "shadow", selection: shadowMissingKey })).resolves.toEqual({ status: "FALLBACK_CONFIGURED" });
  });

  it("routes production analysis jobs to runAnalysisStage on the isolated agentic pipeline queue version", async () => {
    const run = vi.fn().mockResolvedValue({ score: 100 });
    const handler = createAnalysisJobHandler(run);
    await handler({ data: { scanId: "scan-worker" } } as never);
    expect(run).toHaveBeenCalledWith("scan-worker");
    expect(productionAnalysisStage).toBe(runAnalysisStage);
    expect(pipelineVersion).toBe("sentinel-pipeline-v4-agentic");
  });
});
