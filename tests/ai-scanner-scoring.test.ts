import { describe, expect, it } from "vitest";
import { calculateAiScannerScore } from "@/ai-scanner/scoring";

const coverage = { pagesOpened: ["https://shop.example/"], pagesVisuallyReviewed: ["https://shop.example/"], visualRegionsInspected: 2, productsDiscovered: 1, productsVerified: 1, documentsInspected: [], checkoutStatesInspected: [] };

describe("AI Scanner transparent scoring", () => {
  it("uses validated Luna attributes without letting Luna choose the score", () => {
    const score = calculateAiScannerScore([{ title: "High material issue", severity: "HIGH", confidence: 0.9, materialityWeight: 1, commercialProminence: 0.8, visualProminence: 0.7, productAssociation: true, mitigation: 0.2 }], coverage, []);
    expect(score.formulaVersion).toBe("ai-scanner-score-v1");
    expect(score.score).toBeLessThan(100);
    expect(score.deductions[0].inputs).toMatchObject({ severity: "HIGH", confidence: 0.9, productAssociation: true });
  });

  it("never awards a perfect score to an unobserved audit", () => {
    const score = calculateAiScannerScore([], { ...coverage, pagesOpened: [], pagesVisuallyReviewed: [], visualRegionsInspected: 0, productsDiscovered: 0, productsVerified: 0 }, ["Homepage pixels were not available."]);
    expect(score.score).toBeLessThan(100);
    expect(score.uncertaintyReservation).toBeGreaterThan(0);
  });
});
