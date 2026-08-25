import type { CandidateFinding, SentinelSeverity } from "@/sentinel/types";
import { analyzeContext } from "./contextual-signals";

const severityRank: Record<SentinelSeverity, number> = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
const baseClaimRules = new Set(["MKT-MEDICAL-001", "MKT-TESTIMONIAL-001", "MKT-CLAIM-001", "RSRCH-ADMIN-001"]);
const repeatedEvidenceRules = new Set([...baseClaimRules, "MKT-INTENDED-USE-001", "POSITION-CONFLICT-001"]);

function normalizedEvidence(finding: CandidateFinding) {
  return finding.detectedText?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
}

function guardedSeverity(finding: CandidateFinding): SentinelSeverity {
  if (finding.severity === "CRITICAL" && (!finding.detectedText || finding.confidence < 0.9)) return "HIGH";
  if ((finding.severity === "CRITICAL" || finding.severity === "HIGH") && finding.confidence < 0.7) return "MEDIUM";
  return finding.severity;
}

export function isScorableCandidate(finding: CandidateFinding) {
  if (finding.status === "OPEN") return true;
  if (finding.severity === "CRITICAL" || finding.severity === "HIGH") return finding.confidence >= 0.86 && Boolean(finding.detectedText || finding.secondaryEvidence);
  if (finding.severity === "MEDIUM") return finding.confidence >= 0.82 && Boolean(finding.detectedText || finding.secondaryEvidence || finding.affectedUrls?.length);
  return false;
}

export function isMaterialCandidate(finding: CandidateFinding) {
  if (finding.severity !== "CRITICAL" && finding.severity !== "HIGH") return false;
  if (finding.status === "OPEN") return finding.confidence >= 0.9;
  return finding.confidence >= 0.9 && Boolean(finding.detectedText || finding.secondaryEvidence);
}

/**
 * Applies the final evidence-quality gate before findings reach persistence or scoring.
 * It removes duplicate manifestations of one signal without discarding affected URLs.
 */
export function consolidateCandidates(input: CandidateFinding[]) {
  const conflictEvidence = new Set(input.filter((finding) => finding.ruleKey === "POSITION-CONFLICT-001").map((finding) => `${finding.url}|${normalizedEvidence(finding)}`));
  const withoutShadowFindings = input.filter((finding) => !(baseClaimRules.has(finding.ruleKey) && conflictEvidence.has(`${finding.url}|${normalizedEvidence(finding)}`)));
  const repeatedEvidence = new Map<string, CandidateFinding>();
  const retained: CandidateFinding[] = [];

  for (const original of withoutShadowFindings) {
    const finding = { ...original, severity: guardedSeverity(original) };
    const evidence = normalizedEvidence(finding);
    const disclaimerEvidence = evidence && analyzeContext(evidence).type === "RESEARCH_RESTRICTION";
    if (!evidence || (!repeatedEvidenceRules.has(finding.ruleKey) && !disclaimerEvidence)) {
      retained.push(finding);
      continue;
    }
    const key = `${finding.ruleKey}|${evidence}`;
    const current = repeatedEvidence.get(key);
    if (!current) {
      repeatedEvidence.set(key, finding);
      continue;
    }
    const affectedUrls = [...new Set([...(current.affectedUrls ?? [current.url]), ...(finding.affectedUrls ?? [finding.url])])];
    if (severityRank[finding.severity] > severityRank[current.severity] || (finding.severity === current.severity && finding.confidence > current.confidence)) {
      repeatedEvidence.set(key, { ...finding, affectedUrls });
    } else {
      repeatedEvidence.set(key, { ...current, affectedUrls });
    }
  }

  const byRuleAndPage = new Map<string, CandidateFinding>();
  for (const finding of [...retained, ...repeatedEvidence.values()]) {
    const evidence = normalizedEvidence(finding);
    const key = evidence && repeatedEvidenceRules.has(finding.ruleKey) ? `${finding.ruleKey}|${evidence}` : `${finding.ruleKey}|${finding.url}`;
    const current = byRuleAndPage.get(key);
    if (!current || severityRank[finding.severity] > severityRank[current.severity] || (finding.severity === current.severity && finding.confidence > current.confidence)) byRuleAndPage.set(key, finding);
  }
  return [...byRuleAndPage.values()];
}
