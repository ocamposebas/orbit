import type { AuditCoverage, ScoreFinding } from "../types";

const severityPoints: Record<ScoreFinding["severity"], number> = {
  CRITICAL: 30,
  HIGH: 18,
  MEDIUM: 10,
  LOW: 4,
  INFO: 0,
};

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export type FindingDeduction = {
  title: string;
  points: number;
  inputs: {
    severity: ScoreFinding["severity"];
    confidence: number;
    materiality: number;
    commercialProminence: number;
    visualProminence: number;
    productAssociation: boolean;
    mitigation: number;
  };
};

export type ScoreResult = {
  score: number;
  formulaVersion: "ai-scanner-score-v1";
  riskDeduction: number;
  uncertaintyReservation: number;
  deductions: FindingDeduction[];
  explanation: string[];
};

export function calculateAiScannerScore(
  findings: ScoreFinding[],
  coverage: Pick<AuditCoverage, "pagesOpened" | "pagesVisuallyReviewed" | "visualRegionsInspected" | "productsDiscovered" | "productsVerified" | "documentsInspected" | "checkoutStatesInspected">,
  limitations: string[],
): ScoreResult {
  const deductions = findings.map((finding) => {
    const confidence = clamp(finding.confidence);
    const materiality = clamp(finding.materialityWeight);
    const commercial = 0.6 + clamp(finding.commercialProminence) * 0.4;
    const visual = 0.75 + clamp(finding.visualProminence) * 0.25;
    const product = finding.productAssociation ? 1.12 : 1;
    const mitigation = 1 - clamp(finding.mitigation) * 0.6;
    const points = severityPoints[finding.severity] * confidence * materiality * commercial * visual * product * mitigation;
    return {
      title: finding.title,
      points: Number(points.toFixed(2)),
      inputs: {
        severity: finding.severity,
        confidence,
        materiality,
        commercialProminence: clamp(finding.commercialProminence),
        visualProminence: clamp(finding.visualProminence),
        productAssociation: finding.productAssociation,
        mitigation: clamp(finding.mitigation),
      },
    };
  });
  const riskDeduction = Number(deductions.reduce((sum, item) => sum + item.points, 0).toFixed(2));

  // This is deliberately a reservation, not a claimed coverage percentage.
  // It only prevents unobserved or explicitly limited audits from receiving an
  // automatic perfect score.
  let uncertaintyReservation = Math.max(1, Math.min(15, limitations.length * 2));
  if (coverage.pagesOpened.length === 0) uncertaintyReservation = Math.max(uncertaintyReservation, 15);
  if (coverage.pagesVisuallyReviewed.length === 0 || coverage.visualRegionsInspected === 0) uncertaintyReservation = Math.max(uncertaintyReservation, 12);
  if (coverage.productsDiscovered > coverage.productsVerified) uncertaintyReservation = Math.max(uncertaintyReservation, 4);
  uncertaintyReservation = Number(uncertaintyReservation.toFixed(2));

  return {
    score: Math.max(0, Math.round(100 - riskDeduction - uncertaintyReservation)),
    formulaVersion: "ai-scanner-score-v1",
    riskDeduction,
    uncertaintyReservation,
    deductions,
    explanation: [
      "Each finding starts with its severity weight, then scales by validated confidence, materiality, commercial and visual prominence, product association, and mitigation.",
      "A separate uncertainty reservation prevents unknown or unobserved surfaces from producing an automatic perfect score.",
      "Configured tool or runtime limits are not treated as evidence of complete coverage.",
    ],
  };
}
