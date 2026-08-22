import { describe, expect, it } from "vitest";
import { calculateHealthScore } from "@/sentinel/analysis/score";
import { smartDiff } from "@/sentinel/analysis/diff";
import type { CandidateFinding } from "@/sentinel/types";

const finding: CandidateFinding = { ruleKey: "MKT-001", severity: "HIGH", confidence: 0.96, status: "NEEDS_REVIEW", category: "Marketing", title: "Claim", description: "Signal", url: "https://example.test/product", pageType: "PRODUCT", reason: "Context", recommendedAction: "Review", scoreComponent: "MARKETING_RISK" };

describe("explainable scoring and smart diff", () => {
  it("deducts the documented amount from the affected component", () => { const score = calculateHealthScore([finding]); const marketing = score.components.find((item) => item.key === "MARKETING_RISK"); expect(marketing?.score).toBe(84); expect(marketing?.deductions[0].points).toBe(16); expect(score.total).toBe(97); });
  it("marks a newly introduced consumer outcome as high impact", () => { const diff = smartDiff("Investigated in metabolic research models.", "Supports rapid fat loss and appetite suppression."); expect(diff.riskImpact).toBe("HIGH"); expect(diff.additions).toHaveLength(1); expect(diff.removals).toHaveLength(1); });
});
