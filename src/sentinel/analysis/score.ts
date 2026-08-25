import type { CandidateFinding, ScoreComponentKey } from "@/sentinel/types";
import { materialRiskTheme } from "./candidate-quality";

const labels: Record<ScoreComponentKey, string> = { POLICY_COVERAGE: "Website legitimacy", PRODUCT_INTEGRITY: "Product page compliance", RESEARCH_CONTROLS: "Research positioning", MARKETING_RISK: "Claims & intended use", SITE_CONTROLS: "Checkout risk controls", OPERATIONAL_CONSISTENCY: "Operational risk" };
const weights: Record<ScoreComponentKey, number> = { POLICY_COVERAGE: 0.22, PRODUCT_INTEGRITY: 0.18, RESEARCH_CONTROLS: 0.18, MARKETING_RISK: 0.2, SITE_CONTROLS: 0.12, OPERATIONAL_CONSISTENCY: 0.1 };
const deductions = { CRITICAL: 35, HIGH: 16, MEDIUM: 8, LOW: 3, INFO: 0 } as const;
const severityRank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 } as const;
const prominenceMultiplier: Record<NonNullable<CandidateFinding["prominence"]>, number> = { PRIMARY_COMMERCIAL: 1.2, PRODUCT_DESCRIPTION: 1.1, NAVIGATION: 1.05, SITEWIDE: 1, EDITORIAL: 0.75, TECHNICAL: 0.65 };

function inferredProminence(finding: CandidateFinding): NonNullable<CandidateFinding["prominence"]> {
  if (finding.prominence) return finding.prominence;
  if (["PRODUCT", "COLLECTION", "CATEGORY", "CHECKOUT", "CART"].includes(finding.pageType)) return "PRIMARY_COMMERCIAL";
  if (["ARTICLE", "BLOG"].includes(finding.pageType)) return "EDITORIAL";
  return "SITEWIDE";
}

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
      const prominence = Math.max(...themedFindings.map((finding) => prominenceMultiplier[inferredProminence(finding)]));
      const confidence = Math.max(...themedFindings.map((finding) => finding.confidence));
      const confidenceMultiplier = 0.85 + Math.min(1, confidence) * 0.15;
      const hasMitigation = themedFindings.some((finding) => (finding.mitigatingEvidence?.length ?? 0) > 0);
      const mitigationMultiplier = hasMitigation && !theme.startsWith("CONTRADICTION:") ? 0.9 : 1;
      const adjustedBase = Math.max(base ? 1 : 0, Math.round(base * prominence * confidenceMultiplier * mitigationMultiplier));
      const incrementalOccurrences = Math.min(2, Math.max(0, occurrenceUrls.size - 1));
      const incremental = Math.min(Math.round(adjustedBase * 0.5), incrementalOccurrences * Math.ceil(adjustedBase * 0.25));
      return { ruleKey: theme, severity: primary.severity, points: adjustedBase + incremental, title: occurrenceUrls.size > 1 ? `${primary.title} (${occurrenceUrls.size} pages; repeat impact capped)` : primary.title };
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
  return { total, formulaVersion: "orbit-health-v8", components, explanation: { basis: "Internal ORBIT score derived from unique material risk themes, severity, validated confidence, deterministic prominence, mitigating controls, capped repetition, and observed coverage.", scale: { minimum: 0, maximum: 100, higherIsBetter: true }, weights, assessmentCoverage, uncertaintyFloor: 70, repeatedThemeCap: 1.5, prominenceMultipliers: prominenceMultiplier, note: "Each unique material risk theme receives one prominence- and confidence-adjusted deduction. Evidence on additional pages adds at most two 25% increments, capped at 150% of that theme deduction. Related evidence on one page does not multiply score impact. Mitigating evidence can reduce a non-contradiction theme by at most 10%. Model output supplies observations only; deterministic code calculates the score." } };
}
