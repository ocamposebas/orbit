import { evidenceRiskTheme, type EvidenceRiskTheme } from "@/sentinel/analysis/evidence-classification";
import { getDatabase } from "@/sentinel/db";
import type { EvidenceManifest, EvidenceManifestRecord } from "@/sentinel/evidence/schema";
import { contentHash } from "@/sentinel/extraction/normalize";
import type { CandidateFinding, ScoreComponentKey, SentinelPageType } from "@/sentinel/types";
import type { VerifiedFact } from "@/sentinel/verification/schema";
import type { LunaCritic, MaterialDisagreement } from "./critic";
import type { LunaMerchantReview, LunaObservation } from "./schema";

export type AdjudicationDomain = "SEMANTIC_CONTEXT" | "OBJECTIVE_FACT" | "MIXED";

const semanticRules = /^(?:SEM-|MKT-|RSRCH-ADMIN|MKT-INTENDED|RX-REVIEW|POSITION-|VISUAL-|DOCUMENT-)/;

export function candidateDomain(candidate: CandidateFinding): AdjudicationDomain {
  if (candidate.analysisSource === "SEMANTIC_PAGE" || candidate.analysisSource === "SEMANTIC_MERCHANT") return "SEMANTIC_CONTEXT";
  if (semanticRules.test(candidate.ruleKey)) return "SEMANTIC_CONTEXT";
  if (candidate.ruleKey === "POLICY-QUALITY-001" || candidate.ruleKey === "PROD-DISC-001") return "MIXED";
  return "OBJECTIVE_FACT";
}

function candidateTheme(candidate: CandidateFinding): EvidenceRiskTheme {
  const declared = candidate.riskTheme?.replace(/^CONTRADICTION:/, "") as EvidenceRiskTheme | undefined;
  const allowed: EvidenceRiskTheme[] = ["WEIGHT_METABOLIC", "MUSCLE_PERFORMANCE", "COGNITIVE_NEUROLOGICAL", "REPRODUCTIVE_FERTILITY", "RECOVERY_HEALING", "LONGEVITY_AGING", "MEDICAL_DISEASE", "DOSING_ADMINISTRATION", "PHARMACY_PRESCRIPTION", "COSMETIC", "GENERAL"];
  if (declared && allowed.includes(declared)) return declared;
  return evidenceRiskTheme(`${candidate.detectedText ?? ""} ${candidate.title} ${candidate.reason}`);
}

function scoreComponent(theme: EvidenceRiskTheme): ScoreComponentKey {
  if (theme === "DOSING_ADMINISTRATION") return "RESEARCH_CONTROLS";
  if (theme === "PHARMACY_PRESCRIPTION") return "OPERATIONAL_CONSISTENCY";
  return "MARKETING_RISK";
}

function pageType(record: EvidenceManifestRecord): SentinelPageType {
  const metadata = record.artifactMetadata;
  if (metadata && typeof metadata === "object" && "pageType" in metadata && typeof metadata.pageType === "string") return metadata.pageType as SentinelPageType;
  if (record.artifactKind === "PDF" || record.artifactKind === "DOCUMENT_TEXT") return "COA";
  if (record.artifactKind === "CHECKOUT_STATE") return "CHECKOUT";
  return "OTHER";
}

function evidenceText(record: EvidenceManifestRecord) {
  if (record.exactText) return record.exactText;
  if (record.value !== undefined) return JSON.stringify(record.value).slice(0, 4_000);
  return record.evidenceType;
}

function normalizeMatch(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function retainedRecord(manifest: EvidenceManifest, url: string, text?: string, evidenceType?: string) {
  if (!text) return undefined;
  const needle = normalizeMatch(text);
  return manifest.records
    .filter((record) => record.scope === "MERCHANT_SITE" && record.sourceUrl === url && record.exactText && normalizeMatch(record.exactText).includes(needle))
    .sort((left, right) => Number(right.evidenceType === evidenceType) - Number(left.evidenceType === evidenceType) || (left.exactText?.length ?? 0) - (right.exactText?.length ?? 0))[0];
}

export function attachRetainedCandidateEvidence(candidate: CandidateFinding, manifest: EvidenceManifest): CandidateFinding {
  const primary = retainedRecord(manifest, candidate.url, candidate.detectedText, candidate.evidenceType);
  const secondaryEvidence = candidate.secondaryEvidence ? { ...candidate.secondaryEvidence, evidenceRecordId: candidate.secondaryEvidence.evidenceRecordId ?? retainedRecord(manifest, candidate.secondaryEvidence.url, candidate.secondaryEvidence.text, candidate.secondaryEvidence.evidenceType)?.id } : undefined;
  const supportingEvidence = candidate.supportingEvidence?.map((item) => ({ ...item, evidenceRecordId: item.evidenceRecordId ?? retainedRecord(manifest, item.url, item.text, item.evidenceType)?.id }));
  const mitigatingEvidence = candidate.mitigatingEvidence?.map((item) => ({ ...item, evidenceRecordId: item.evidenceRecordId ?? retainedRecord(manifest, item.url, item.text, item.evidenceType)?.id }));
  const evidenceRecordIds = [...new Set([primary?.id, secondaryEvidence?.evidenceRecordId, ...(supportingEvidence ?? []).map((item) => item.evidenceRecordId), ...(mitigatingEvidence ?? []).map((item) => item.evidenceRecordId)].filter((id): id is string => Boolean(id)))];
  return { ...candidate, secondaryEvidence, supportingEvidence, mitigatingEvidence, evidenceRecordIds };
}

export function lunaObservationCandidate(observation: LunaObservation, manifest: EvidenceManifest): CandidateFinding | undefined {
  if (observation.classification !== "ADVERSE") return undefined;
  const records = observation.evidence.map((reference) => manifest.records.find((record) => record.id === reference.evidenceRecordId)).filter((record): record is EvidenceManifestRecord => Boolean(record));
  if (!records.length || records.some((record) => record.scope !== "MERCHANT_SITE")) return undefined;
  const primary = records.find((record) => observation.evidence.find((reference) => reference.evidenceRecordId === record.id)?.role === "PRIMARY") ?? records[0];
  const orderedRecords = [primary, ...records.filter((record) => record.id !== primary.id)];
  const supportingEvidence = orderedRecords.slice(1).map((record) => ({ url: record.sourceUrl, text: evidenceText(record), role: observation.evidence.find((reference) => reference.evidenceRecordId === record.id)?.role.toLowerCase() ?? "supporting", evidenceType: record.evidenceType, sourceKind: record.artifactKind === "IMAGE" || record.artifactKind === "SCREENSHOT" ? "VISUAL" as const : record.artifactKind === "PDF" || record.artifactKind === "DOCUMENT_TEXT" ? "DOCUMENT" as const : record.artifactKind === "CHECKOUT_STATE" ? "INTERACTIVE" as const : "TEXT" as const, assetStorageKey: record.storageKey, assetHash: record.artifactHash, domSelector: record.selector, evidenceRecordId: record.id, classification: observation.evidence.find((reference) => reference.evidenceRecordId === record.id)?.classification }));
  return {
    ruleKey: `LUNA-${observation.riskTheme}`,
    severity: observation.proposedSeverity,
    confidence: observation.confidence,
    status: observation.humanReviewRequired || observation.confidence < 0.9 ? "NEEDS_REVIEW" : "OPEN",
    category: observation.category,
    title: observation.riskTheme.toLowerCase().replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase()),
    description: observation.conclusion,
    url: primary.sourceUrl,
    pageType: pageType(primary),
    detectedText: primary.exactText,
    reason: observation.conclusion,
    recommendedAction: "Review the cited first-party evidence in its complete merchant context and remediate the supported issue.",
    scoreComponent: scoreComponent(observation.riskTheme),
    supportingEvidence,
    affectedUrls: [...new Set(records.map((record) => record.sourceUrl))],
    analysisSource: "SEMANTIC_MERCHANT",
    evidenceType: primary.evidenceType,
    humanReviewRequired: observation.humanReviewRequired,
    modelVersion: "gpt-5.6-luna",
    provider: "openai-responses",
    semanticCategory: observation.category,
    semanticClassification: observation.classification,
    promptVersion: "orbit-luna-holistic-v1",
    riskTheme: observation.riskTheme,
    evidenceClassification: observation.classification,
    sourceKind: primary.artifactKind === "IMAGE" || primary.artifactKind === "SCREENSHOT" ? "VISUAL" : primary.artifactKind === "PDF" || primary.artifactKind === "DOCUMENT_TEXT" ? "DOCUMENT" : primary.artifactKind === "CHECKOUT_STATE" ? "INTERACTIVE" : "TEXT",
    assetStorageKey: primary.storageKey,
    assetHash: primary.artifactHash,
    evidenceRecordIds: orderedRecords.map((record) => record.id),
    scoreEligible: true,
  };
}

function verifierFactForCandidate(candidate: CandidateFinding, facts: VerifiedFact[]) {
  const policy = candidate.ruleKey.match(/^POLICY-(PRIVACY|TERMS|CONTACT|REFUND|SHIPPING)-/i)?.[1]?.toUpperCase();
  if (policy) return facts.find((item) => item.issueKey === `fact:policy-presence:${policy}`);
  if (candidate.ruleKey === "SITE-HOME-001") return facts.find((item) => item.factType === "URL_STATUS" && item.subjectId === candidate.url);
  if (candidate.ruleKey === "SITE-BROKEN-CRITICAL-001") return facts.find((item) => item.factType === "URL_STATUS" && (candidate.affectedUrls ?? [candidate.url]).includes(item.subjectId) && item.state === "REFUTED");
  return undefined;
}

function verifierSupportsCandidate(candidate: CandidateFinding, item: VerifiedFact | undefined) {
  if (!item) return true;
  if (candidate.ruleKey.startsWith("POLICY-") || candidate.ruleKey === "SITE-HOME-001" || candidate.ruleKey === "SITE-BROKEN-CRITICAL-001") return item.state === "REFUTED";
  return item.state === "VERIFIED";
}

async function decision(input: { scanId: string; issueKey: string; domain: AdjudicationDomain; material: boolean; outcome: "ACCEPTED_LUNA" | "ACCEPTED_VERIFIER" | "ACCEPTED_CRITIC" | "REJECTED" | "NEEDS_REVIEW"; reason: string; scoreEligible: boolean; primaryObservationId?: string; verificationAssertionId?: string; criticRunId?: string }) {
  return getDatabase().adjudicationDecision.upsert({
    where: { scanId_issueKey: { scanId: input.scanId, issueKey: input.issueKey } },
    update: { domain: input.domain, material: input.material, outcome: input.outcome, reason: input.reason, scoreEligible: input.scoreEligible, primaryObservationId: input.primaryObservationId, verificationAssertionId: input.verificationAssertionId, criticRunId: input.criticRunId },
    create: input,
  });
}

export async function adjudicateDualReview(input: { scanId: string; merchantId: string; deterministicCandidates: CandidateFinding[]; review?: LunaMerchantReview; reviewRunId?: string; manifest: EvidenceManifest; verifierFacts: VerifiedFact[]; critic?: LunaCritic; maxDisagreements: number }) {
  const db = getDatabase();
  const storedObservations = input.reviewRunId ? await db.reviewObservation.findMany({ where: { reviewRunId: input.reviewRunId } }) : [];
  const observationId = new Map(storedObservations.map((item) => [item.issueKey, item.id]));
  const assertions = await db.verificationAssertion.findMany({ where: { scanId: input.scanId } });
  const assertionId = new Map(assertions.map((item) => [item.issueKey, item.id]));
  const accepted: CandidateFinding[] = [];

  for (const observation of input.review?.observations ?? []) {
    const candidate = lunaObservationCandidate(observation, input.manifest);
    const stored = await decision({ scanId: input.scanId, issueKey: `luna:${observation.issueKey}`, domain: "SEMANTIC_CONTEXT", material: observation.materiality === "MATERIAL", outcome: "ACCEPTED_LUNA", reason: `Luna has priority for the supported semantic/context conclusion classified ${observation.classification}.`, scoreEligible: Boolean(candidate), primaryObservationId: observationId.get(observation.issueKey) });
    if (candidate) accepted.push({ ...candidate, adjudicationId: stored.id });
  }

  const conflicts: Array<{ candidate: CandidateFinding; observation: LunaObservation; disagreement: MaterialDisagreement }> = [];
  for (const candidate of input.deterministicCandidates) {
    const domain = candidateDomain(candidate);
    const material = candidate.severity === "CRITICAL" || candidate.severity === "HIGH" || candidate.severity === "MEDIUM";
    const issueKey = `deterministic:${candidate.ruleKey}:${contentHash(candidate.riskTheme ?? candidate.url).slice(0, 16)}`;
    if (domain === "OBJECTIVE_FACT") {
      const verifier = verifierFactForCandidate(candidate, input.verifierFacts);
      const supported = verifierSupportsCandidate(candidate, verifier);
      const stored = await decision({ scanId: input.scanId, issueKey, domain, material, outcome: supported ? "ACCEPTED_VERIFIER" : "REJECTED", reason: supported ? "The deterministic verifier has priority for this objective fact." : "The independent deterministic verifier refuted this objective candidate.", scoreEligible: supported, verificationAssertionId: verifier ? assertionId.get(verifier.issueKey) : undefined });
      if (supported) accepted.push({ ...candidate, adjudicationId: stored.id, scoreEligible: true });
      continue;
    }
    const theme = candidateTheme(candidate);
    const matching = input.review?.observations.find((observation) => observation.riskTheme === theme);
    if (matching?.classification === "ADVERSE") continue;
    if (matching && material && matching.materiality === "MATERIAL") {
      const evidenceRecordIds = [...new Set([...matching.evidence.map((reference) => reference.evidenceRecordId), ...(candidate.evidenceRecordIds ?? [])])];
      conflicts.push({ candidate, observation: matching, disagreement: { issueKey, luna: matching, deterministicCandidate: candidate, verifierFact: verifierFactForCandidate(candidate, input.verifierFacts), evidenceRecordIds } });
      continue;
    }
    const stored = await decision({ scanId: input.scanId, issueKey, domain, material, outcome: "NEEDS_REVIEW", reason: matching ? "Luna did not classify the matching context as adverse; the disagreement is non-material or insufficiently supported for critic escalation." : "The deterministic semantic signal was not corroborated by the primary holistic Luna review.", scoreEligible: false, primaryObservationId: matching ? observationId.get(matching.issueKey) : undefined });
    accepted.push({ ...candidate, status: "NEEDS_REVIEW", adjudicationId: stored.id, scoreEligible: false });
  }

  const selected = conflicts.slice(0, input.maxDisagreements);
  let criticResult: Awaited<ReturnType<LunaCritic["review"]>> | undefined;
  if (selected.length && input.critic) criticResult = await input.critic.review({ scanId: input.scanId, merchantId: input.merchantId, manifest: input.manifest, disagreements: selected.map((item) => item.disagreement) });
  for (const conflict of conflicts) {
    const criticDecision = criticResult?.decisions.decisions.find((item) => item.issueKey === conflict.disagreement.issueKey);
    const supportsDeterministic = criticDecision?.decision === "SUPPORT_VERIFIER";
    const supportsLuna = criticDecision?.decision === "SUPPORT_LUNA";
    const outcome = supportsDeterministic || supportsLuna ? "ACCEPTED_CRITIC" as const : "NEEDS_REVIEW" as const;
    const stored = await decision({ scanId: input.scanId, issueKey: conflict.disagreement.issueKey, domain: candidateDomain(conflict.candidate), material: true, outcome, reason: criticDecision?.explanation ?? "The material disagreement could not be resolved and requires review.", scoreEligible: supportsDeterministic, primaryObservationId: observationId.get(conflict.observation.issueKey), criticRunId: criticResult?.runId });
    if (supportsDeterministic || !supportsLuna) accepted.push({ ...conflict.candidate, status: supportsDeterministic ? conflict.candidate.status : "NEEDS_REVIEW", adjudicationId: stored.id, scoreEligible: supportsDeterministic });
  }
  return { candidates: accepted, materialDisagreements: conflicts.length, criticRunId: criticResult?.runId };
}
