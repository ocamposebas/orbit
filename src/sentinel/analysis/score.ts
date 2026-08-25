import type { CandidateFinding, ScoreComponentKey } from "@/sentinel/types";
import { materialRiskTheme } from "./candidate-quality";

const labels: Record<ScoreComponentKey, string> = { POLICY_COVERAGE: "Website legitimacy", PRODUCT_INTEGRITY: "Product page compliance", RESEARCH_CONTROLS: "Research positioning", MARKETING_RISK: "Claims & intended use", SITE_CONTROLS: "Checkout risk controls", OPERATIONAL_CONSISTENCY: "Operational risk" };
const weights: Record<ScoreComponentKey, number> = { POLICY_COVERAGE: 0.22, PRODUCT_INTEGRITY: 0.18, RESEARCH_CONTROLS: 0.18, MARKETING_RISK: 0.2, SITE_CONTROLS: 0.12, OPERATIONAL_CONSISTENCY: 0.1 };
const deductions = { CRITICAL: 35, HIGH: 16, MEDIUM: 8, LOW: 3, INFO: 0 } as const;
const severityRank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 } as const;

export function calculateHealthScore(findings: CandidateFinding[], assessmentCoverage: Partial<Record<ScoreComponentKey, number>> = {}) {
  const keys = Object.keys(labels) as ScoreComponentKey[];
  const components = keys.map((key) => {
    const themes = new Map<string, CandidateFinding[]>();
    for (const finding of findings.filter((item) => item.scoreComponent === key && item.status !== undefined)) {
      const theme = materialRiskTheme(finding);
      themes.set(theme, [...(themes.get(theme) ?? []), finding]);
    }
    const deductionRows: Array<{ ruleKey: string; severity: CandidateFinding["severity"]; points: number; title: string }> = [...themes.entries()].map(([theme, themedFindings]) => {
      const primary = [...themedFindings].sort((left, right) => severityRank[right.severity] - severityRank[left.severity] || right.confidence - left.confidence)[0];
      const occurrenceUrls = new Set(themedFindings.flatMap((finding) => finding.affectedUrls ?? [finding.url]));
      const base = deductions[primary.severity];
      const incrementalOccurrences = Math.min(2, Math.max(0, occurrenceUrls.size - 1));
      const incremental = Math.min(Math.round(base * 0.5), incrementalOccurrences * Math.ceil(base * 0.25));
      return { ruleKey: theme, severity: primary.severity, points: base + incremental, title: occurrenceUrls.size > 1 ? `${primary.title} (${occurrenceUrls.size} pages; repeat impact capped)` : primary.title };
    });
    const observedScore = Math.max(0, 100 - deductionRows.reduce((sum, row) => sum + row.points, 0));
    const coverage = Math.max(0, Math.min(100, assessmentCoverage[key] ?? 100));
    const coverageAdjusted = Math.round(observedScore * (coverage / 100) + 70 * (1 - coverage / 100));
    const score = Math.min(observedScore, coverageAdjusted);
    const coverageAdjustment = observedScore - score;
    if (coverageAdjustment > 0) deductionRows.push({ ruleKey: "ASSESSMENT-COVERAGE", severity: "INFO", points: coverageAdjustment, title: `Evidence coverage ${coverage}% — uninspected scope is treated as uncertainty, not as a violation` });
    return { key, label: labels[key], score, observedScore, assessmentCoverage: coverage, deductions: deductionRows };
  });
  const total = Math.round(components.reduce((sum, component) => sum + component.score * weights[component.key], 0));
  return { total, formulaVersion: "orbit-health-v7", components, explanation: { basis: "Internal ORBIT score derived from material risk themes, grouped evidence and the evidence coverage achieved by each assessment area.", scale: { minimum: 0, maximum: 100, higherIsBetter: true }, weights, assessmentCoverage, uncertaintyFloor: 70, repeatedThemeCap: 1.5, note: "Each unique material risk theme receives one full deduction. Evidence on additional pages adds at most two 25% increments, capped at 150% of the theme's base deduction. Related evidence on one page does not multiply score impact. Restrictions, cautions, questions and disclaimers are not treated as promotion. This score is decision support, not a certification." } };
}
