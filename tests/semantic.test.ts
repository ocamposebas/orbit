import { describe, expect, it } from "vitest";
import { analyzeClaim } from "@/sentinel/analysis/semantic";

describe("contextual claim analysis", () => {
  it.each([
    ["Not intended for human consumption.", "neutral", false],
    ["For research use only.", "research_context", false],
    ["Supports rapid weight loss.", "consumer_claim", true],
    ["Studied in preclinical models of metabolic signaling.", "research_context", false],
    ["Inject 2mg twice weekly.", "administration_instruction", true],
    ["Not intended for injection.", "neutral", false],
  ])("classifies %s", (text, classification, consumerDirected) => {
    const result = analyzeClaim(text);
    expect(result.classification).toBe(classification);
    expect(result.consumerDirected).toBe(consumerDirected);
    expect(result.confidence).toBeGreaterThan(0.7);
  });
});
