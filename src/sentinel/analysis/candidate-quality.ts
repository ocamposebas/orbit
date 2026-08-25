import type { CandidateFinding, SentinelSeverity } from "@/sentinel/types";
import { analyzeContext } from "./contextual-signals";

const severityRank: Record<SentinelSeverity, number> = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
const baseClaimRules = new Set(["MKT-MEDICAL-001", "MKT-TESTIMONIAL-001", "MKT-CLAIM-001", "RSRCH-ADMIN-001"]);
const repeatedEvidenceRules = new Set([...baseClaimRules, "MKT-INTENDED-USE-001", "POSITION-CONFLICT-001"]);

function evidenceScopedRule(ruleKey: string) {
  return repeatedEvidenceRules.has(ruleKey) || ruleKey.startsWith("SEM-");
}

function normalizedEvidence(finding: CandidateFinding) {
  return finding.detectedText?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
}

function riskTopic(text: string) {
  if (/\b(?:cogniti\w*|memory|neuroprotect\w*|focus)\b/i.test(text)) return "COGNITIVE_NEUROLOGICAL";
  if (/\b(?:muscle|hypertroph\w*|human performance|bodybuild\w*)\b/i.test(text)) return "MUSCLE_PERFORMANCE";
  if (/\b(?:obesity|weight|appetite|adiposity|body[- ]?fat|metaboli\w*|fat[- ]?loss)\b/i.test(text)) return "WEIGHT_METABOLIC";
  if (/\b(?:reproductive|fertility|fertile)\b/i.test(text)) return "REPRODUCTIVE_FERTILITY";
  if (/\b(?:recovery|healing|injur\w*)\b/i.test(text)) return "RECOVERY_HEALING";
  if (/\b(?:longevity|anti[- ]?aging|lifespan)\b/i.test(text)) return "LONGEVITY_AGING";
  if (/\b(?:cosmetic|skin|beauty|topical)\b/i.test(text)) return "COSMETIC";
  return "GENERAL";
}

export function materialRiskTheme(finding: CandidateFinding) {
  if (finding.riskTheme) return finding.riskTheme;
  const text = `${finding.detectedText ?? ""} ${finding.title} ${finding.category}`;
  const rule = finding.ruleKey;
  const topic = riskTopic(text);
  if (/CONFLICT|CONTRADICTION|DECEPTIVE|INCONSISTENT/.test(rule) || finding.semanticCategory === "CONTRADICTION" || finding.semanticCategory === "DECEPTIVE_INCONSISTENT_POSITIONING") return `CONTRADICTION:${topic}`;
  if (/MEDICAL/.test(rule) || finding.semanticCategory === "MEDICAL_CLAIM") return `MEDICAL_CLAIM:${topic}`;
  if (/ADMIN|DOSING/.test(rule) || finding.semanticCategory === "DOSING_ADMINISTRATION") return `DOSING_ADMINISTRATION:${topic}`;
  if (/TESTIMONIAL/.test(rule)) return `TESTIMONIAL:${topic}`;
  if (/PHARMACY|PRESCRIPTION|^RX-/.test(rule) || finding.semanticCategory === "PHARMACY_PRESCRIPTION") return `PHARMACY_PRESCRIPTION:${topic}`;
  if (finding.scoreComponent === "MARKETING_RISK" || /MKT-|INTENDED_USE|HUMAN_THERAPEUTIC_OUTCOME/.test(rule)) return `PHYSIOLOGICAL_OUTCOME:${topic}`;
  return `RULE:${rule}`;
}

function pageGroupable(finding: CandidateFinding) {
  return finding.scoreComponent === "MARKETING_RISK" || /^(?:MKT-|RSRCH-ADMIN|RX-REVIEW|POSITION-CONFLICT|SEM-(?:PAGE|MERCHANT)-(?:INTENDED_USE|HUMAN_THERAPEUTIC_OUTCOME|MEDICAL_CLAIM|DOSING_ADMINISTRATION|CONTRADICTION|DECEPTIVE_INCONSISTENT_POSITIONING))/.test(finding.ruleKey);
}

function preferredFinding(left: CandidateFinding, right: CandidateFinding) {
  if (severityRank[right.severity] > severityRank[left.severity] || (right.severity === left.severity && right.confidence > left.confidence)) return right;
  return left;
}

function evidenceKey(evidence: { url: string; text: string }) {
  return `${evidence.url}|${evidence.text.replace(/\s+/g, " ").trim().toLowerCase()}`;
}

function groupPageFindings(left: CandidateFinding, right: CandidateFinding, theme: string): CandidateFinding {
  const preferred = preferredFinding(left, right);
  const primaryKey = evidenceKey({ url: preferred.url, text: preferred.detectedText ?? preferred.title });
  const secondaryKey = preferred.secondaryEvidence ? evidenceKey(preferred.secondaryEvidence) : "";
  const evidence = [
    ...(left.detectedText ? [{ url: left.url, text: left.detectedText, role: "related-theme-evidence", evidenceType: left.evidenceType }] : []),
    ...(right.detectedText ? [{ url: right.url, text: right.detectedText, role: "related-theme-evidence", evidenceType: right.evidenceType }] : []),
    ...(left.secondaryEvidence ? [{ ...left.secondaryEvidence, evidenceType: undefined }] : []),
    ...(right.secondaryEvidence ? [{ ...right.secondaryEvidence, evidenceType: undefined }] : []),
    ...(left.supportingEvidence ?? []),
    ...(right.supportingEvidence ?? []),
  ];
  const supportingEvidence = [...new Map(evidence.filter((item) => evidenceKey(item) !== primaryKey && evidenceKey(item) !== secondaryKey).map((item) => [evidenceKey(item), item])).values()];
  const affectedUrls = [...new Set([...(left.affectedUrls ?? [left.url]), ...(right.affectedUrls ?? [right.url])])];
  return { ...preferred, riskTheme: theme, supportingEvidence, affectedUrls };
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
  const withoutContradictionShadows = input.filter((finding) => !(baseClaimRules.has(finding.ruleKey) && conflictEvidence.has(`${finding.url}|${normalizedEvidence(finding)}`)));
  const deterministicEvidence = new Set(withoutContradictionShadows.filter((finding) => !finding.ruleKey.startsWith("SEM-") && normalizedEvidence(finding)).map((finding) => `${finding.scoreComponent}|${normalizedEvidence(finding)}`));
  const semanticByEvidence = new Map<string, CandidateFinding>();
  const withoutShadowFindings: CandidateFinding[] = [];
  for (const finding of withoutContradictionShadows) {
    const evidence = normalizedEvidence(finding);
    if (!finding.ruleKey.startsWith("SEM-") || !evidence) {
      withoutShadowFindings.push(finding);
      continue;
    }
    const key = `${finding.scoreComponent}|${evidence}`;
    if (deterministicEvidence.has(key)) continue;
    const current = semanticByEvidence.get(key);
    if (!current) {
      semanticByEvidence.set(key, finding);
      continue;
    }
    const affectedUrls = [...new Set([...(current.affectedUrls ?? [current.url]), ...(finding.affectedUrls ?? [finding.url])])];
    if (severityRank[finding.severity] > severityRank[current.severity] || (finding.severity === current.severity && finding.confidence > current.confidence)) semanticByEvidence.set(key, { ...finding, affectedUrls });
    else semanticByEvidence.set(key, { ...current, affectedUrls });
  }
  withoutShadowFindings.push(...semanticByEvidence.values());
  const repeatedEvidence = new Map<string, CandidateFinding>();
  const retained: CandidateFinding[] = [];

  for (const original of withoutShadowFindings) {
    const finding = { ...original, severity: guardedSeverity(original) };
    const evidence = normalizedEvidence(finding);
    const disclaimerEvidence = evidence && analyzeContext(evidence).type === "RESEARCH_RESTRICTION";
    if (!evidence || (!evidenceScopedRule(finding.ruleKey) && !disclaimerEvidence)) {
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
    const key = evidence && evidenceScopedRule(finding.ruleKey) ? `${finding.ruleKey}|${evidence}` : `${finding.ruleKey}|${finding.url}`;
    const current = byRuleAndPage.get(key);
    if (!current || severityRank[finding.severity] > severityRank[current.severity] || (finding.severity === current.severity && finding.confidence > current.confidence)) byRuleAndPage.set(key, finding);
  }
  const groupedByPageAndTheme = new Map<string, CandidateFinding>();
  const ungrouped: CandidateFinding[] = [];
  for (const finding of byRuleAndPage.values()) {
    if (!pageGroupable(finding) || !finding.detectedText) {
      ungrouped.push(finding);
      continue;
    }
    const theme = materialRiskTheme(finding);
    const key = `${finding.url}|${finding.scoreComponent}|${theme}`;
    const current = groupedByPageAndTheme.get(key);
    groupedByPageAndTheme.set(key, current ? groupPageFindings(current, finding, theme) : { ...finding, riskTheme: theme });
  }
  return [...ungrouped, ...groupedByPageAndTheme.values()];
}
