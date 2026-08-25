import { z } from "zod";
import { contentHash, normalizeText } from "@/sentinel/extraction/normalize";
import type { CandidateFinding, SentinelPageType, SentinelSeverity } from "@/sentinel/types";
import { materialRiskTheme } from "./candidate-quality";
import { classifyTextEvidence, evidenceClassifications, type EvidenceClassification } from "./evidence-classification";

export const evidenceClassificationSchema = z.enum(evidenceClassifications);
export const evidenceProminenceSchema = z.enum(["PRIMARY_COMMERCIAL", "PRODUCT_DESCRIPTION", "SITEWIDE", "NAVIGATION", "EDITORIAL", "TECHNICAL"]);

export const intelligenceEvidenceSchema = z.object({
  id: z.string(),
  evidenceRecordId: z.string().optional(),
  sourceType: z.enum(["TEXT", "VISUAL", "DOCUMENT", "INTERACTIVE"]),
  evidenceType: z.string(),
  classification: evidenceClassificationSchema,
  url: z.string(),
  pageType: z.string(),
  quote: z.string(),
  domSelector: z.string().optional(),
  assetReference: z.string().optional(),
  sourceHash: z.string(),
  severity: z.string(),
  confidence: z.number().min(0).max(1),
  prominence: evidenceProminenceSchema,
  category: z.string(),
  context: z.string(),
  ruleKey: z.string(),
  modelVersion: z.string().optional(),
  promptVersion: z.string().optional(),
}).strict();

export const riskThemeNodeSchema = z.object({
  id: z.string(),
  riskTheme: z.string(),
  title: z.string(),
  severity: z.string(),
  confidence: z.number(),
  scoreComponent: z.string(),
  evidence: z.array(intelligenceEvidenceSchema),
  mitigatingEvidence: z.array(intelligenceEvidenceSchema),
  affectedUrls: z.array(z.string()),
  adjudicationIds: z.array(z.string()),
  scoreEligible: z.boolean(),
}).strict();

export const evidenceGraphSchema = z.object({
  version: z.literal("orbit-evidence-graph-v1"),
  generatedAt: z.string(),
  themes: z.array(riskThemeNodeSchema),
}).strict();

export type EvidenceGraph = z.infer<typeof evidenceGraphSchema>;

const severityRank: Record<SentinelSeverity, number> = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 };

function classification(candidate: CandidateFinding) {
  return candidate.evidenceClassification ?? (candidate.detectedText ? classifyTextEvidence(candidate.detectedText) : "ADVERSE");
}

function evidenceRecord(candidate: CandidateFinding, input: { url: string; text: string; evidenceType?: string; classification?: EvidenceClassification; role?: string; sourceKind?: "TEXT" | "VISUAL" | "DOCUMENT" | "INTERACTIVE"; assetStorageKey?: string; assetHash?: string; domSelector?: string; evidenceRecordId?: string }) {
  const sourceType = input.sourceKind ?? candidate.sourceKind ?? "TEXT";
  const sourceHash = input.assetHash ?? candidate.assetHash ?? contentHash(`${sourceType}|${input.url}|${normalizeText(input.text).toLowerCase()}`);
  return intelligenceEvidenceSchema.parse({ id: contentHash(`${materialRiskTheme(candidate)}|${sourceHash}|${input.role ?? "primary"}`), evidenceRecordId: input.evidenceRecordId, sourceType, evidenceType: input.evidenceType ?? candidate.evidenceType ?? "VISIBLE_TEXT", classification: input.classification ?? classification(candidate), url: input.url, pageType: candidate.pageType, quote: input.text, domSelector: input.domSelector ?? (input.role === "primary" ? candidate.domSelector : undefined), assetReference: input.assetStorageKey ?? (input.role === "primary" ? candidate.assetStorageKey : undefined), sourceHash, severity: candidate.severity, confidence: candidate.confidence, prominence: candidate.prominence ?? (candidate.pageType === "PRODUCT" || candidate.pageType === "COLLECTION" || candidate.pageType === "CATEGORY" || candidate.pageType === "CHECKOUT" ? "PRIMARY_COMMERCIAL" : candidate.pageType === "ARTICLE" || candidate.pageType === "BLOG" ? "EDITORIAL" : "SITEWIDE"), category: candidate.category, context: candidate.reason, ruleKey: candidate.ruleKey, modelVersion: candidate.modelVersion, promptVersion: candidate.promptVersion });
}

export function buildEvidenceGraph(candidates: CandidateFinding[], pageRestrictions: Array<{ url: string; pageType: SentinelPageType; text: string }> = [], generatedAt = new Date()) {
  const groups = new Map<string, CandidateFinding[]>();
  for (const candidate of candidates) {
    const theme = materialRiskTheme(candidate);
    const group = groups.get(theme) ?? [];
    group.push(candidate); groups.set(theme, group);
  }
  const themes = [...groups.entries()].map(([riskTheme, findings]) => {
    const strongest = [...findings].sort((left, right) => severityRank[right.severity] - severityRank[left.severity] || right.confidence - left.confidence)[0];
    const records = findings.flatMap((finding) => [
      evidenceRecord(finding, { url: finding.url, text: finding.detectedText ?? finding.title, evidenceType: finding.evidenceType, evidenceRecordId: finding.evidenceRecordIds?.[0], role: "primary" }),
      ...(finding.secondaryEvidence ? [evidenceRecord(finding, { ...finding.secondaryEvidence, classification: finding.secondaryEvidence.classification ?? classifyTextEvidence(finding.secondaryEvidence.text) })] : []),
      ...(finding.supportingEvidence ?? []).map((item) => evidenceRecord(finding, { ...item, classification: item.classification ?? classifyTextEvidence(item.text) })),
    ]);
    const evidence = records.filter((record) => record.classification === "ADVERSE");
    const contextualEvidence = records.filter((record) => record.classification !== "ADVERSE");
    const explicitMitigating = findings.flatMap((finding) => (finding.mitigatingEvidence ?? []).map((item) => evidenceRecord(finding, { url: item.url, text: item.text, evidenceType: item.evidenceType, classification: "MITIGATING", role: item.role })));
    const restrictions = pageRestrictions.map((restriction) => evidenceRecord(strongest, { url: restriction.url, text: restriction.text, evidenceType: "DISCLAIMER", classification: "MITIGATING", role: "merchant-restriction" }));
    const unique = (items: ReturnType<typeof evidenceRecord>[]) => [...new Map(items.map((item) => [`${item.sourceType}|${item.sourceHash}|${item.classification}`, item])).values()];
    return riskThemeNodeSchema.parse({ id: contentHash(riskTheme), riskTheme, title: strongest.title, severity: strongest.severity, confidence: Math.max(...findings.map((finding) => finding.confidence)), scoreComponent: strongest.scoreComponent, evidence: unique(evidence), mitigatingEvidence: unique([...contextualEvidence, ...explicitMitigating, ...restrictions]), affectedUrls: [...new Set(findings.flatMap((finding) => [finding.url, ...(finding.affectedUrls ?? []), ...(finding.secondaryEvidence ? [finding.secondaryEvidence.url] : []), ...(finding.supportingEvidence ?? []).map((item) => item.url)]))], adjudicationIds: [...new Set(findings.flatMap((finding) => finding.adjudicationId ? [finding.adjudicationId] : []))], scoreEligible: findings.some((finding) => finding.scoreEligible !== false) });
  });
  return evidenceGraphSchema.parse({ version: "orbit-evidence-graph-v1", generatedAt: generatedAt.toISOString(), themes });
}
