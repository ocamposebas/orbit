import type { CandidateFinding, ScoreComponentKey } from "@/sentinel/types";

const labels: Record<ScoreComponentKey, string> = { POLICY_COVERAGE: "Website legitimacy", PRODUCT_INTEGRITY: "Product page compliance", RESEARCH_CONTROLS: "Research positioning", MARKETING_RISK: "Claims & intended use", SITE_CONTROLS: "Checkout risk controls", OPERATIONAL_CONSISTENCY: "Operational risk" };
const weights: Record<ScoreComponentKey, number> = { POLICY_COVERAGE: 0.22, PRODUCT_INTEGRITY: 0.18, RESEARCH_CONTROLS: 0.18, MARKETING_RISK: 0.2, SITE_CONTROLS: 0.12, OPERATIONAL_CONSISTENCY: 0.1 };
const deductions = { CRITICAL: 35, HIGH: 16, MEDIUM: 8, LOW: 3, INFO: 0 } as const;

export function calculateHealthScore(findings: CandidateFinding[]) {
  const keys = Object.keys(labels) as ScoreComponentKey[];
  const components = keys.map((key) => {
    const seen = new Set<string>();
    const relevant = findings.filter((finding) => finding.scoreComponent === key && finding.status !== undefined).filter((finding) => {
      const identity = `${finding.ruleKey}|${finding.url}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
    const deductionRows = relevant.map((finding) => ({ ruleKey: finding.ruleKey, severity: finding.severity, points: deductions[finding.severity], title: finding.title }));
    return { key, label: labels[key], score: Math.max(0, 100 - deductionRows.reduce((sum, row) => sum + row.points, 0)), deductions: deductionRows };
  });
  const total = Math.round(components.reduce((sum, component) => sum + component.score * weights[component.key], 0));
  return { total, formulaVersion: "orbit-health-v3", components, explanation: { basis: "Internal ORBIT score derived from material, deduplicated website signals and open findings.", scale: { minimum: 0, maximum: 100, higherIsBetter: true }, weights, note: "0 represents the weakest observed posture and 100 the strongest. Repeated instances of the same rule on one page are deducted once. This score is decision support, not a legal determination or external approval metric." } };
}
