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
    ["We are not a pharmacy.", "neutral", false],
    ["We are not a compounding pharmacy.", "neutral", false],
    ["Products are not intended to diagnose, treat, cure, or prevent disease.", "neutral", false],
    ["Obesity Research Products", "needs_review", false],
    ["Muscle Growth Research Products", "needs_review", false],
    ["Cognitive Research Products", "needs_review", false],
    ["Reproductive Research Products", "needs_review", false],
    ["Recovery Research Products", "needs_review", false],
  ])("classifies %s", (text, classification, consumerDirected) => {
    const result = analyzeClaim(text);
    expect(result.classification).toBe(classification);
    expect(result.consumerDirected).toBe(consumerDirected);
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("does not let research wording neutralize a direct physiological claim", () => {
    expect(analyzeClaim("Supports appetite suppression in research.")).toEqual(expect.objectContaining({ classification: "consumer_claim", risk: "high" }));
  });
});
