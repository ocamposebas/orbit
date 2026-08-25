import { beforeEach, describe, expect, it, vi } from "vitest";
import { evidenceManifestSchema } from "@/sentinel/evidence/schema";
import { LunaMerchantReviewer, lunaStructuredResponseLogFields, parseLunaStructuredOutput, type ResponsesOutput } from "@/sentinel/review/luna";
import { lunaMerchantReviewJsonSchema, lunaMerchantReviewSchema, type LunaMerchantReview } from "@/sentinel/review/schema";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/sentinel/db", () => ({
  getDatabase: () => ({ reviewRun: { findFirst: mocks.findFirst, create: mocks.create, update: mocks.update } }),
}));

function review(evidenceRecordIds = ["evidence-1"]): LunaMerchantReview {
  return lunaMerchantReviewSchema.parse({
    version: "orbit-luna-review-v1",
    merchantSummary: { businessModel: "Observed research catalog", overallContext: "The retained merchant evidence was reviewed globally.", evidenceRecordIds },
    observations: [],
    uncertainties: [],
  });
}

function response(output: string, overrides: Partial<ResponsesOutput> = {}): ResponsesOutput {
  return { id: "resp-1", status: "completed", incomplete_details: null, output_text: output, usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }, ...overrides };
}

function apiResponse(raw: ResponsesOutput, requestId: string) {
  return new Response(JSON.stringify(raw), { status: 200, headers: { "content-type": "application/json", "x-request-id": requestId } });
}

function manifest() {
  return evidenceManifestSchema.parse({
    version: "orbit-evidence-manifest-v1",
    scanId: "scan-1",
    generatedAt: "2026-08-25T12:00:00.000Z",
    records: [
      { id: "evidence-1", artifactId: "page-1", scope: "MERCHANT_SITE", artifactKind: "PAGE_SNAPSHOT", sourceUrl: "https://merchant.test/", evidenceType: "VISIBLE_TEXT", exactText: "Research catalog", sourceHash: "source-1", artifactHash: "artifact-1" },
      { id: "evidence-2", artifactId: "page-2", scope: "MERCHANT_SITE", artifactKind: "PAGE_SNAPSHOT", sourceUrl: "https://merchant.test/about", evidenceType: "VISIBLE_TEXT", exactText: "Laboratory context", sourceHash: "source-2", artifactHash: "artifact-2" },
    ],
  });
}

function reviewer(request: typeof fetch) {
  return new LunaMerchantReviewer({ apiKey: "test-key", baseUrl: "https://api.openai.test/v1", model: "gpt-5.6-luna", reasoningEffort: "high", timeoutMs: 10_000, maxOutputTokens: 3_000, maxInputChars: 100_000, maxRecords: 1, maxImages: 40, maxImageBytes: 1_000_000 }, request);
}

beforeEach(() => {
  vi.clearAllMocks();
  let run = 0;
  mocks.findFirst.mockResolvedValue(null);
  mocks.create.mockImplementation(async () => ({ id: `run-${++run}` }));
  mocks.update.mockResolvedValue({});
});

describe("Luna final structured output", () => {
  it("accepts a valid strict structured merchant review", () => {
    const expected = review();
    expect(parseLunaStructuredOutput(response(JSON.stringify(expected)))).toEqual({ review: expected, outputText: JSON.stringify(expected) });
    expect(lunaMerchantReviewJsonSchema).toMatchObject({ type: "object", additionalProperties: false });
  });

  it("rejects malformed or truncated JSON instead of accepting a partial review", () => {
    expect(() => parseLunaStructuredOutput(response('{"version":"orbit-luna-review-v1","merchantSummary":{"businessModel":"unterminated'))).toThrowError(expect.objectContaining({ reason: "MALFORMED_STRUCTURED_OUTPUT", phase: "response_parsing" }));
  });

  it("checks max_output_tokens incompleteness before attempting JSON parsing", () => {
    const incomplete = response("{malformed", { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage: { output_tokens: 3_000 } });
    expect(() => parseLunaStructuredOutput(incomplete)).toThrowError(expect.objectContaining({ reason: "INCOMPLETE_MAX_OUTPUT_TOKENS", incompleteReason: "max_output_tokens", outputTokens: 3_000 }));
  });

  it("logs final completion diagnostics without including request or merchant payloads", () => {
    expect(lunaStructuredResponseLogFields({ response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage: { output_tokens: 3_000 } }, requestId: "req-final", outputCharacters: 35_826, validationResult: "NOT_ATTEMPTED_INCOMPLETE", retryReason: "INCOMPLETE_MAX_OUTPUT_TOKENS", retryCount: 1 })).toEqual({
      responseStatus: "incomplete",
      incompleteReason: "max_output_tokens",
      outputTokens: 3_000,
      finalOutputCharacterCount: 35_826,
      structuredOutputValidationResult: "NOT_ATTEMPTED_INCOMPLETE",
      retryReason: "INCOMPLETE_MAX_OUTPUT_TOKENS",
      retryCount: 1,
      requestId: "req-final",
    });
  });

  it("rejects JSON that does not satisfy the existing Luna runtime schema", () => {
    expect(() => parseLunaStructuredOutput(response(JSON.stringify({ version: "orbit-luna-review-v1", merchantSummary: { businessModel: "Catalog" }, observations: [], uncertainties: [] })))).toThrowError(expect.objectContaining({ reason: "SCHEMA_INVALID", phase: "json_schema_validation" }));
  });

  it("retries only the final pass and succeeds from the completed shard outputs", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(apiResponse(response(JSON.stringify(review(["evidence-1"])), { id: "shard-1" }), "req-shard-1"))
      .mockResolvedValueOnce(apiResponse(response(JSON.stringify(review(["evidence-2"])), { id: "shard-2" }), "req-shard-2"))
      .mockResolvedValueOnce(apiResponse(response("{malformed", { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage: { output_tokens: 3_000 } }), "req-final-failed"))
      .mockResolvedValueOnce(apiResponse(response(JSON.stringify(review(["evidence-1", "evidence-2"])), { id: "final-retry" }), "req-final-retry"));

    const result = await reviewer(request).review({ scanId: "scan-1", merchantId: "merchant-1", merchantName: "Merchant", merchantDescription: "Research catalog", manifest: manifest() });

    expect(result.review.merchantSummary.evidenceRecordIds).toEqual(["evidence-1", "evidence-2"]);
    expect(request).toHaveBeenCalledTimes(4);
    const requestBodies = request.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
    expect(requestBodies.every((body) => {
      const format = ((body.text as { format: Record<string, unknown> }).format);
      return format.type === "json_schema" && format.strict === true && JSON.stringify(format.schema) === JSON.stringify(lunaMerchantReviewJsonSchema);
    })).toBe(true);
    expect(requestBodies[3].max_output_tokens).toBeGreaterThan(requestBodies[2].max_output_tokens as number);
  });

  it("does not call completed evidence shards again during a final parse retry", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(apiResponse(response(JSON.stringify(review(["evidence-1"])), { id: "shard-1" }), "req-shard-1"))
      .mockResolvedValueOnce(apiResponse(response(JSON.stringify(review(["evidence-2"])), { id: "shard-2" }), "req-shard-2"))
      .mockResolvedValueOnce(apiResponse(response("{truncated"), "req-final-failed"))
      .mockResolvedValueOnce(apiResponse(response(JSON.stringify(review(["evidence-1", "evidence-2"])), { id: "final-retry" }), "req-final-retry"));

    await reviewer(request).review({ scanId: "scan-1", merchantId: "merchant-1", merchantName: "Merchant", merchantDescription: "Research catalog", manifest: manifest() });

    const payloads = request.mock.calls.map(([, init]) => {
      const body = JSON.parse(String(init?.body)) as { input: Array<{ content: Array<{ text: string }> }> };
      return JSON.parse(body.input[0].content[0].text) as Record<string, unknown>;
    });
    expect(payloads.filter((payload) => "shard" in payload)).toHaveLength(2);
    expect(payloads.filter((payload) => "shardReviews" in payload)).toHaveLength(2);
  });
});
