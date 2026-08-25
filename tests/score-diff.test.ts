import { describe, expect, it } from "vitest";
import { calculateHealthScore } from "@/sentinel/analysis/score";
import { smartDiff } from "@/sentinel/analysis/diff";
import type { CandidateFinding } from "@/sentinel/types";

const finding: CandidateFinding = { ruleKey: "MKT-001", severity: "HIGH", confidence: 0.96, status: "NEEDS_REVIEW", category: "Marketing", title: "Claim", description: "Signal", url: "https://example.test/product", pageType: "PRODUCT", reason: "Context", recommendedAction: "Review", scoreComponent: "MARKETING_RISK" };

describe("explainable scoring and smart diff", () => {
  it("applies deterministic commercial prominence to the affected component", () => { const score = calculateHealthScore([finding]); const marketing = score.components.find((item) => item.key === "MARKETING_RISK"); expect(marketing?.score).toBe(81); expect(marketing?.deductions[0].points).toBe(19); expect(score.total).toBe(96); });
  it("uses 100 for the strongest posture and deduplicates identical observations", () => {
    expect(calculateHealthScore([]).total).toBe(100);
    const score = calculateHealthScore([finding, finding]);
    expect(score.components.find((item) => item.key === "MARKETING_RISK")?.deductions).toHaveLength(1);
    expect(score.explanation.scale).toEqual({ minimum: 0, maximum: 100, higherIsBetter: true });
  });
  it("scores related claim evidence on one page as one material theme", () => {
    const second = { ...finding, detectedText: "A second claim on the same page" };
    const score = calculateHealthScore([{ ...finding, detectedText: "First claim" }, second]);
    expect(score.components.find((item) => item.key === "MARKETING_RISK")?.deductions).toHaveLength(1);
  });
  it("scores twenty repeated high-risk occurrences as one material theme", () => {
    const repeated = Array.from({ length: 20 }, (_, index) => ({ ...finding, url: `https://example.test/article-${index}`, detectedText: `Muscle growth and hypertrophy evidence ${index}` }));
    const score = calculateHealthScore(repeated);
    const marketing = score.components.find((item) => item.key === "MARKETING_RISK");
    expect(marketing?.deductions).toHaveLength(1);
    expect(marketing?.deductions[0].points).toBe(19);
    expect(marketing?.score).toBe(81);
  });
  it("keeps materially different claim types as separate scoring themes", () => {
    const medical = { ...finding, ruleKey: "MKT-MEDICAL-001", detectedText: "Treats cognitive disease." };
    const testimonial = { ...finding, ruleKey: "MKT-TESTIMONIAL-001", detectedText: "My memory improved." };
    const score = calculateHealthScore([medical, testimonial]);
    expect(score.components.find((item) => item.key === "MARKETING_RISK")?.deductions).toHaveLength(2);
  });
  it("deducts identical claim evidence only once when copied across pages", () => {
    const score = calculateHealthScore([{ ...finding, detectedText: "Obesity Research Products" }, { ...finding, url: "https://example.test/other", detectedText: "Obesity Research Products" }]);
    expect(score.components.find((item) => item.key === "MARKETING_RISK")?.deductions).toHaveLength(1);
  });
  it("does not award a perfect score to material assessment areas that were not inspected", () => {
    const score = calculateHealthScore([], { SITE_CONTROLS: 0, OPERATIONAL_CONSISTENCY: 50 });
    expect(score.total).toBeLessThan(100);
    expect(score.components.find((item) => item.key === "SITE_CONTROLS")).toEqual(expect.objectContaining({ observedScore: 100, assessmentCoverage: 0, score: 70 }));
  });
  it("marks a newly introduced consumer outcome as high impact", () => { const diff = smartDiff("Investigated in metabolic research models.", "Supports rapid fat loss and appetite suppression."); expect(diff.riskImpact).toBe("HIGH"); expect(diff.additions).toHaveLength(1); expect(diff.removals).toHaveLength(1); });
});
