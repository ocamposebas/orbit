import type { CandidateFinding, ScoreComponentKey } from "@/sentinel/types";

const labels: Record<ScoreComponentKey, string> = { POLICY_COVERAGE: "Website legitimacy", PRODUCT_INTEGRITY: "Product page compliance", RESEARCH_CONTROLS: "Research positioning", MARKETING_RISK: "Claims & intended use", SITE_CONTROLS: "Checkout risk controls", OPERATIONAL_CONSISTENCY: "Operational risk" };
const weights: Record<ScoreComponentKey, number> = { POLICY_COVERAGE: 0.22, PRODUCT_INTEGRITY: 0.18, RESEARCH_CONTROLS: 0.18, MARKETING_RISK: 0.2, SITE_CONTROLS: 0.12, OPERATIONAL_CONSISTENCY: 0.1 };
const deductions = { CRITICAL: 35, HIGH: 16, MEDIUM: 8, LOW: 3, INFO: 0 } as const;

export function calculateHealthScore(findings: CandidateFinding[], assessmentCoverage: Partial<Record<ScoreComponentKey, number>> = {}) {
  const keys = Object.keys(labels) as ScoreComponentKey[];
  const components = keys.map((key) => {
    const seen = new Set<string>();
    const relevant = findings.filter((finding) => finding.scoreComponent === key && finding.status !== undefined).filter((finding) => {
      const identity = `${finding.ruleKey}|${finding.url}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
    const deductionRows: Array<{ ruleKey: string; severity: CandidateFinding["severity"]; points: number; title: string }> = relevant.map((finding) => ({ ruleKey: finding.ruleKey, severity: finding.severity, points: deductions[finding.severity], title: finding.title }));
    const observedScore = Math.max(0, 100 - deductionRows.reduce((sum, row) => sum + row.points, 0));
    const coverage = Math.max(0, Math.min(100, assessmentCoverage[key] ?? 100));
    const coverageAdjusted = Math.round(observedScore * (coverage / 100) + 70 * (1 - coverage / 100));
    const score = Math.min(observedScore, coverageAdjusted);
    const coverageAdjustment = observedScore - score;
    if (coverageAdjustment > 0) deductionRows.push({ ruleKey: "ASSESSMENT-COVERAGE", severity: "INFO", points: coverageAdjustment, title: `Evidence coverage ${coverage}% — uninspected scope is treated as uncertainty, not as a violation` });
    return { key, label: labels[key], score, observedScore, assessmentCoverage: coverage, deductions: deductionRows };
  });
  const total = Math.round(components.reduce((sum, component) => sum + component.score * weights[component.key], 0));
  return { total, formulaVersion: "orbit-health-v5", components, explanation: { basis: "Internal ORBIT score derived from material, deduplicated website signals and the evidence coverage achieved by each assessment area.", scale: { minimum: 0, maximum: 100, higherIsBetter: true }, weights, assessmentCoverage, uncertaintyFloor: 70, note: "Uninspected scope cannot create a violation, but it prevents an unsupported perfect score. Repeated evidence is consolidated across pages, and a restriction or disclaimer is not treated as promotion. This score is decision support, not a certification." } };
}
