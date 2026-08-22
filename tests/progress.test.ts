import { describe, expect, it } from "vitest";
import { initialProgress, mergeProgress } from "@/sentinel/services/progress";

describe("recoverable scan progress", () => {
  it("never moves a retry back to an earlier pipeline stage", () => {
    const current = { ...initialProgress(), stage: "classifying" as const, pagesProcessed: 24, pagesTotal: 24, attempt: 1, stageProcessed: 24, stageTotal: 24 };
    const progress = mergeProgress(current, { stage: "discovering", pagesProcessed: 0, pagesTotal: 1, attempt: 2, message: "Recovering" }, "2026-01-01T00:00:00.000Z");
    expect(progress.stage).toBe("classifying");
    expect(progress.pagesProcessed).toBe(24);
    expect(progress.pagesTotal).toBe(24);
    expect(progress.attempt).toBe(2);
    expect(progress.stageProcessed).toBe(24);
  });

  it("advances counters when the pipeline enters a later stage", () => {
    const current = { ...initialProgress(), stage: "classifying" as const, stageProcessed: 20, stageTotal: 20 };
    const progress = mergeProgress(current, { stage: "analyzing", stageProcessed: 4, stageTotal: 12 });
    expect(progress.stage).toBe("analyzing");
    expect(progress.stageProcessed).toBe(4);
    expect(progress.stageTotal).toBe(12);
  });

  it("allows a terminal failure to replace an active stage", () => {
    const progress = mergeProgress({ ...initialProgress(), stage: "analyzing" }, { stage: "failed", message: "Analysis failed" });
    expect(progress.stage).toBe("failed");
    expect(progress.message).toBe("Analysis failed");
  });
});
