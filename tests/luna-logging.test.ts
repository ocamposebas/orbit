import { describe, expect, it } from "vitest";
import { sanitizeLogText, serializeErrorForLog } from "@/sentinel/logger";
import { LUNA_GRADUAL_MAX_INPUT_CHARS, lunaFailureLogFields, lunaPartitionCharacterLimit, lunaRequestLogFields, shouldSplitOversizedLunaRequest } from "@/sentinel/review/luna";

describe("Luna logging", () => {
  it("serializes Error properties instead of producing an empty object", () => {
    const error = new TypeError("Responses API failed");
    const serialized = serializeErrorForLog(error);

    expect(serialized.name).toBe("TypeError");
    expect(serialized.message).toBe("Responses API failed");
    expect(serialized.stack).toContain("TypeError: Responses API failed");
  });

  it("redacts common credentials from diagnostic text", () => {
    const text = sanitizeLogText("Authorization: Bearer secret-token cookie=session-value token=another-secret sk-test123456789");

    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("session-value");
    expect(text).not.toContain("another-secret");
    expect(text).not.toContain("sk-test123456789");
  });

  it("redacts the configured AI API key even when it has a nonstandard prefix", () => {
    const previous = process.env.AI_API_KEY;
    process.env.AI_API_KEY = "configured-custom-key-value";
    try {
      expect(sanitizeLogText("Failure for configured-custom-key-value")).toBe("Failure for [REDACTED]");
    } finally {
      if (previous === undefined) delete process.env.AI_API_KEY;
      else process.env.AI_API_KEY = previous;
    }
  });

  it("builds a structured sanitized OpenAI failure without exposing the API key or JSON response body", () => {
    const apiKey = "custom-live-api-key-value";
    const error = new Error(`Request rejected for ${apiKey}`);
    const fields = lunaFailureLogFields({
      error,
      phase: "request",
      elapsedMs: 151.6,
      apiKey,
      httpStatus: 429,
      requestId: "req_123",
      rawResponse: { error: { message: `Rate limited ${apiKey}`, type: "rate_limit_error", code: "rate_limit_exceeded", param: "model" } },
      responseBody: JSON.stringify({ error: { message: "Rate limited" }, merchantPayload: "must-not-be-logged" }),
      responseOk: false,
    });

    expect(fields).toMatchObject({
      errorName: "Error",
      httpStatus: 429,
      openaiErrorType: "rate_limit_error",
      openaiErrorCode: "rate_limit_exceeded",
      openaiErrorParam: "model",
      responseBodyMessage: "Rate limited [REDACTED]",
      requestId: "req_123",
      phase: "request",
      elapsedMs: 152,
    });
    expect(JSON.stringify(fields)).not.toContain(apiKey);
    expect(JSON.stringify(fields)).not.toContain("must-not-be-logged");
  });

  it("logs only the requested preflight request metrics", () => {
    const fields = lunaRequestLogFields({
      model: "gpt-5.6-luna",
      evidenceRecordCount: 42,
      imageCount: 3,
      approximateInputCharacters: 12_345,
      maxOutputTokens: 8_000,
      reasoningEffort: "high",
      timeoutMs: 120_000,
    });

    expect(fields).toEqual({
      model: "gpt-5.6-luna",
      evidenceRecordCount: 42,
      imageCount: 3,
      approximateInputCharacters: 12_345,
      maxOutputTokens: 8_000,
      reasoningEffort: "high",
      timeoutMs: 120_000,
    });
  });

  it("caps large configured inputs so Luna evidence is sent in gradual shards", () => {
    expect(lunaPartitionCharacterLimit(850_000)).toBe(LUNA_GRADUAL_MAX_INPUT_CHARS);
    expect(lunaPartitionCharacterLimit(200_000)).toBe(200_000);
  });

  it("splits only a per-request token-size rejection, not every rate limit", () => {
    expect(shouldSplitOversizedLunaRequest({
      httpStatus: 429,
      openaiErrorType: "tokens",
      openaiErrorCode: "rate_limit_exceeded",
      message: "Request too large. Limit 200000, Requested 257035 tokens per min (TPM).",
    })).toBe(true);
    expect(shouldSplitOversizedLunaRequest({
      httpStatus: 429,
      openaiErrorType: "requests",
      openaiErrorCode: "rate_limit_exceeded",
      message: "Rate limit reached; retry later.",
    })).toBe(false);
    expect(shouldSplitOversizedLunaRequest({
      httpStatus: 429,
      openaiErrorType: "tokens",
      openaiErrorCode: "rate_limit_exceeded",
      message: "Token rate limit reached. Used 140000, Requested 120000. Try again in 18.5s.",
    })).toBe(false);
  });
});
