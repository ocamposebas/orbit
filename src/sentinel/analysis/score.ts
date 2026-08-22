import type { CandidateFinding, ScoreComponentKey } from "@/sentinel/types";

const labels: Record<ScoreComponentKey, string> = { POLICY_COVERAGE: "Policy coverage", PRODUCT_INTEGRITY: "Product integrity", RESEARCH_CONTROLS: "Research controls", MARKETING_RISK: "Marketing risk", SITE_CONTROLS: "Checkout controls", OPERATIONAL_CONSISTENCY: "Operational consistency" };
const weights: Record<ScoreComponentKey, number> = { POLICY_COVERAGE: 0.22, PRODUCT_INTEGRITY: 0.18, RESEARCH_CONTROLS: 0.18, MARKETING_RISK: 0.2, SITE_CONTROLS: 0.12, OPERATIONAL_CONSISTENCY: 0.1 };
const deductions = { CRITICAL: 35, HIGH: 16, MEDIUM: 8, LOW: 3, INFO: 0 } as const;

export function calculateHealthScore(findings: CandidateFinding[]) {
  const keys = Object.keys(labels) as ScoreComponentKey[];
  const components = keys.map((key) => {
    const seen = new Set<string>();
    const relevant = findings.filter((finding) => finding.scoreComponent === key && finding.status !== undefined).filter((finding) => {
      const identity = `${finding.ruleKey}|${finding.url}|${finding.detectedText ?? finding.title}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
    const deductionRows = relevant.map((finding) => ({ ruleKey: finding.ruleKey, severity: finding.severity, points: deductions[finding.severity], title: finding.title }));
    return { key, label: labels[key], score: Math.max(0, 100 - deductionRows.reduce((sum, row) => sum + row.points, 0)), deductions: deductionRows };
  });
  const total = Math.round(components.reduce((sum, component) => sum + component.score * weights[component.key], 0));
  return { total, formulaVersion: "orbit-health-v2", components, explanation: { basis: "Internal ORBIT score derived from observed website signals and open findings.", scale: { minimum: 0, maximum: 100, higherIsBetter: true }, weights, note: "0 represents the weakest observed posture and 100 the strongest. This score is decision support, not a legal determination or external approval metric." } };
}
