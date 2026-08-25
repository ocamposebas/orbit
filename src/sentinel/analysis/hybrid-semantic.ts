import type { CandidateFinding, NormalizedContent, ScoreComponentKey, SentinelPageType, SentinelSeverity } from "@/sentinel/types";
import { splitSentences } from "@/sentinel/extraction/normalize";
import { logger } from "@/sentinel/logger";
import type { MerchantSemanticAnalysis, MerchantSemanticObservation, PageSemanticAnalysis, SemanticEvidence, SemanticEvidenceType, SemanticObservation } from "./semantic-schema";
import { MERCHANT_SEMANTIC_PROMPT_VERSION, PAGE_SEMANTIC_PROMPT_VERSION, type MerchantSemanticDocument, type PageSemanticDocument, type SemanticUsage, type WebsiteSemanticAnalyzer } from "./website-semantic";

export interface SemanticPageInput {
  url: string;
  pageType: SentinelPageType;
  content: NormalizedContent;
  httpStatus?: number;
}

export interface HybridSemanticStats {
  provider: string;
  model: string;
  pageCalls: number;
  merchantCalls: number;
  cacheHits: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

const policyPageTypes = new Set<SentinelPageType>(["POLICY", "TERMS", "PRIVACY", "REFUND", "SHIPPING", "CONTACT", "FAQ"]);
const riskyClassifications = new Set(["POSITIVE_PROMOTION", "CONTROL_MISSING", "CONTRADICTION", "CONTEXTUAL_REVIEW"]);

function normalized(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function addEvidence(target: SemanticEvidenceItemWithKey[], evidenceType: SemanticEvidenceType, text: string | undefined) {
  const clean = text?.replace(/\s+/g, " ").trim();
  if (!clean) return;
  const key = `${evidenceType}|${clean.toLowerCase()}`;
  if (!target.some((item) => item.key === key)) target.push({ key, evidenceType, text: clean.slice(0, 2_000) });
}

type SemanticEvidenceItemWithKey = PageSemanticDocument["evidenceItems"][number] & { key: string };

export function buildPageSemanticDocument(page: SemanticPageInput, maxChars = 24_000): PageSemanticDocument {
  const items: SemanticEvidenceItemWithKey[] = [];
  addEvidence(items, "TITLE", page.content.title);
  addEvidence(items, "TITLE", page.content.metadata.title);
  addEvidence(items, "TITLE", page.content.metadata.openGraphTitle);
  addEvidence(items, "META_DESCRIPTION", page.content.metadata.description);
  addEvidence(items, "META_DESCRIPTION", page.content.metadata.openGraphDescription);
  for (const heading of page.content.headings) addEvidence(items, "HEADING", heading);
  for (const link of page.content.links) {
    addEvidence(items, "NAVIGATION", link.text);
    if (/\/(?:collections?|categor(?:y|ies))\//i.test(link.href)) addEvidence(items, "CATEGORY_COLLECTION", link.text);
  }
  if (page.pageType === "CATEGORY" || page.pageType === "COLLECTION") {
    addEvidence(items, "CATEGORY_COLLECTION", page.content.title);
    for (const heading of page.content.headings) addEvidence(items, "CATEGORY_COLLECTION", heading);
  }
  for (const breadcrumb of page.content.breadcrumbs) addEvidence(items, "CATEGORY_COLLECTION", breadcrumb);
  addEvidence(items, "PRODUCT_TITLE", page.content.productName);
  if (page.pageType === "PRODUCT") for (const paragraph of page.content.paragraphs) addEvidence(items, "PRODUCT_DESCRIPTION", paragraph);
  for (const button of page.content.buttons) addEvidence(items, "CTA", button);
  for (const field of page.content.forms.flatMap((form) => form.fields)) addEvidence(items, "VISIBLE_TEXT", field.label);
  for (const disclaimer of page.content.disclaimers) addEvidence(items, "DISCLAIMER", disclaimer);
  if (policyPageTypes.has(page.pageType)) for (const text of [...page.content.headings, ...page.content.paragraphs]) addEvidence(items, "POLICY", text);
  if (page.pageType === "CHECKOUT" || page.pageType === "CART") {
    for (const text of [...page.content.buttons, ...page.content.forms.flatMap((form) => form.fields.map((field) => field.label))]) addEvidence(items, "CHECKOUT", text);
    for (const sentence of splitSentences(page.content.visibleText)) addEvidence(items, "CHECKOUT", sentence);
  }
  for (const value of page.content.structuredData) addEvidence(items, "STRUCTURED_DATA", JSON.stringify(value));
  for (const sentence of splitSentences(page.content.visibleText)) addEvidence(items, "VISIBLE_TEXT", sentence);
  for (let offset = 0; offset < page.content.visibleText.length; offset += 1_500) addEvidence(items, "VISIBLE_TEXT", page.content.visibleText.slice(offset, offset + 1_500));

  const bounded: PageSemanticDocument["evidenceItems"] = [];
  let used = 0;
  for (const item of items) {
    if (used >= maxChars) break;
    const text = item.text.slice(0, Math.max(0, maxChars - used));
    if (!text) break;
    bounded.push({ evidenceType: item.evidenceType, text });
    used += text.length;
  }
  return { pageUrl: page.url, pageType: page.pageType, observedControls: page.content.controls, evidenceItems: bounded };
}

function evidenceExists(evidence: SemanticEvidence, inventory: Array<{ url: string; evidenceType: SemanticEvidenceType; text: string }>) {
  const needle = normalized(evidence.exactText);
  return inventory.some((item) => item.url === evidence.url && item.evidenceType === evidence.evidenceType && normalized(item.text).includes(needle));
}

function deduplicateObservations<T extends SemanticObservation>(observations: T[]): T[] {
  const retained = new Map<string, T>();
  for (const observation of observations) {
    const key = `${observation.category}|${observation.classification}|${observation.evidence.url}|${observation.evidence.evidenceType}|${normalized(observation.evidence.exactText)}`;
    const current = retained.get(key);
    if (!current || observation.confidence > current.confidence) retained.set(key, observation);
  }
  return [...retained.values()];
}

export function validatePageSemanticAnalysis(document: PageSemanticDocument, analysis: PageSemanticAnalysis): PageSemanticAnalysis {
  if (analysis.pageUrl !== document.pageUrl) return { pageUrl: document.pageUrl, observations: [] };
  const inventory = document.evidenceItems.map((item) => ({ url: document.pageUrl, ...item }));
  return { pageUrl: document.pageUrl, observations: deduplicateObservations(analysis.observations.filter((observation) => evidenceExists(observation.evidence, inventory))) };
}

function merchantInventory(document: MerchantSemanticDocument) {
  const fromPages = document.pages.flatMap((page) => page.observations.map((observation) => observation.evidence));
  const fromRules = document.deterministicFindings.filter((finding) => finding.exactEvidence).map((finding) => ({ url: finding.url, evidenceType: finding.evidenceType, exactText: finding.exactEvidence }));
  return [...fromPages, ...fromRules].map((evidence) => ({ url: evidence.url, evidenceType: evidence.evidenceType, text: evidence.exactText }));
}

export function validateMerchantSemanticAnalysis(document: MerchantSemanticDocument, analysis: MerchantSemanticAnalysis): MerchantSemanticAnalysis {
  const inventory = merchantInventory(document);
  const observations = analysis.observations.filter((observation) => evidenceExists(observation.evidence, inventory) && observation.supportingEvidence.every((evidence) => evidenceExists(evidence, inventory)));
  return { observations: deduplicateObservations(observations) };
}

const scoreComponentByCategory: Record<SemanticObservation["category"], ScoreComponentKey> = {
  INTENDED_USE: "MARKETING_RISK",
  HUMAN_THERAPEUTIC_OUTCOME: "MARKETING_RISK",
  RESEARCH_POSITIONING: "RESEARCH_CONTROLS",
  CONTRADICTION: "OPERATIONAL_CONSISTENCY",
  DISCLAIMER: "RESEARCH_CONTROLS",
  PHARMACY_PRESCRIPTION: "OPERATIONAL_CONSISTENCY",
  DOSING_ADMINISTRATION: "RESEARCH_CONTROLS",
  MEDICAL_CLAIM: "MARKETING_RISK",
  QUALIFICATION_CONTROL: "RESEARCH_CONTROLS",
  CHECKOUT_CONTROL: "SITE_CONTROLS",
  POLICY_COVERAGE: "POLICY_COVERAGE",
  DECEPTIVE_INCONSISTENT_POSITIONING: "OPERATIONAL_CONSISTENCY",
};

const titleByCategory: Record<SemanticObservation["category"], string> = {
  INTENDED_USE: "Semantic intended-use signal requires review",
  HUMAN_THERAPEUTIC_OUTCOME: "Semantic human-outcome positioning requires review",
  RESEARCH_POSITIONING: "Semantic research-positioning observation",
  CONTRADICTION: "Cross-context contradiction requires review",
  DISCLAIMER: "Semantic disclaimer observation",
  PHARMACY_PRESCRIPTION: "Semantic pharmacy or prescription context requires review",
  DOSING_ADMINISTRATION: "Semantic dosing or administration language requires review",
  MEDICAL_CLAIM: "Semantic medical-claim signal requires review",
  QUALIFICATION_CONTROL: "Semantic qualification-control gap requires review",
  CHECKOUT_CONTROL: "Semantic checkout-control gap requires review",
  POLICY_COVERAGE: "Semantic policy-coverage gap requires review",
  DECEPTIVE_INCONSISTENT_POSITIONING: "Potentially inconsistent merchant positioning requires review",
};

function guardedSemanticSeverity(observation: SemanticObservation): SentinelSeverity {
  if (observation.severity !== "CRITICAL") return observation.severity;
  if (observation.confidence >= 0.9 && ["MEDICAL_CLAIM", "DOSING_ADMINISTRATION", "CONTRADICTION", "DECEPTIVE_INCONSISTENT_POSITIONING"].includes(observation.category)) return "CRITICAL";
  return "HIGH";
}

function pageTypeForUrl(pages: SemanticPageInput[], url: string): SentinelPageType {
  return pages.find((page) => page.url === url)?.pageType ?? "OTHER";
}

function observationCandidate(observation: SemanticObservation, pages: SemanticPageInput[], source: "SEMANTIC_PAGE" | "SEMANTIC_MERCHANT", provider: string, model: string): CandidateFinding | undefined {
  if (!riskyClassifications.has(observation.classification) || !observation.humanReviewRequired || observation.confidence < 0.7) return undefined;
  const prefix = source === "SEMANTIC_PAGE" ? "SEM-PAGE" : "SEM-MERCHANT";
  return {
    ruleKey: `${prefix}-${observation.category}`,
    severity: guardedSemanticSeverity(observation),
    confidence: observation.confidence,
    status: "NEEDS_REVIEW",
    category: observation.category.replaceAll("_", " ").toLowerCase(),
    title: titleByCategory[observation.category],
    description: "Structured semantic analysis identified a contextual website observation that passed exact-evidence validation.",
    url: observation.evidence.url,
    pageType: pageTypeForUrl(pages, observation.evidence.url),
    detectedText: observation.evidence.exactText,
    reason: observation.contextualExplanation,
    recommendedAction: "Review the cited evidence in full page and merchant context. Treat this as an observation, not an approval, certification, or legal conclusion.",
    scoreComponent: scoreComponentByCategory[observation.category],
    analysisSource: source,
    evidenceType: observation.evidence.evidenceType,
    humanReviewRequired: true,
    provider,
    modelVersion: model,
    semanticCategory: observation.category,
    semanticClassification: observation.classification,
    promptVersion: source === "SEMANTIC_PAGE" ? PAGE_SEMANTIC_PROMPT_VERSION : MERCHANT_SEMANTIC_PROMPT_VERSION,
  };
}

export function pageSemanticCandidates(analysis: PageSemanticAnalysis, pages: SemanticPageInput[], provider: string, model: string) {
  return analysis.observations.flatMap((observation) => {
    const candidate = observationCandidate(observation, pages, "SEMANTIC_PAGE", provider, model);
    return candidate ? [candidate] : [];
  });
}

export function merchantSemanticCandidates(analysis: MerchantSemanticAnalysis, pages: SemanticPageInput[], provider: string, model: string) {
  return analysis.observations.flatMap((observation: MerchantSemanticObservation) => {
    const candidate = observationCandidate(observation, pages, "SEMANTIC_MERCHANT", provider, model);
    if (!candidate) return [];
    return [{ ...candidate, supportingEvidence: observation.supportingEvidence.map((evidence) => ({ url: evidence.url, text: evidence.exactText, role: "supporting-semantic-evidence", evidenceType: evidence.evidenceType })) }];
  });
}

function emptyStats(analyzer: WebsiteSemanticAnalyzer): HybridSemanticStats {
  return { provider: analyzer.provider, model: analyzer.model, pageCalls: 0, merchantCalls: 0, cacheHits: 0, failures: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
}

function addUsage(stats: HybridSemanticStats, usage: SemanticUsage) {
  if (usage.cached) stats.cacheHits++;
  else {
    stats.inputTokens += usage.inputTokens;
    stats.outputTokens += usage.outputTokens;
    stats.estimatedCostUsd += usage.estimatedCostUsd;
  }
}

export async function runHybridSemanticAnalysis(input: { analyzer: WebsiteSemanticAnalyzer; pages: SemanticPageInput[]; merchantName: string; deterministicCandidates: CandidateFinding[]; concurrency?: number; maxPageChars?: number }) {
  const pages = input.pages.filter((page) => page.httpStatus === undefined || page.httpStatus < 400);
  const documents = pages.map((page) => buildPageSemanticDocument(page, input.maxPageChars));
  const analyses: PageSemanticAnalysis[] = [];
  const stats = emptyStats(input.analyzer);
  const concurrency = Math.max(1, Math.min(input.concurrency ?? 3, 8));
  for (let offset = 0; offset < documents.length; offset += concurrency) {
    const batch = documents.slice(offset, offset + concurrency);
    const results = await Promise.all(batch.map(async (document) => {
      try {
        stats.pageCalls++;
        const run = await input.analyzer.analyzePage(document);
        addUsage(stats, run.usage);
        return validatePageSemanticAnalysis(document, run.result);
      } catch (error) {
        stats.failures++;
        logger.warn({ error, pageUrl: document.pageUrl, provider: input.analyzer.provider, model: input.analyzer.model }, "Page semantic analysis failed; deterministic analysis remains available");
        return undefined;
      }
    }));
    analyses.push(...results.filter((result): result is PageSemanticAnalysis => Boolean(result)));
  }

  const pageCandidates = analyses.flatMap((analysis) => pageSemanticCandidates(analysis, pages, input.analyzer.provider, input.analyzer.model));
  const merchantDocument: MerchantSemanticDocument = {
    merchantName: input.merchantName,
    pages: analyses.map((analysis) => ({ pageUrl: analysis.pageUrl, pageType: pageTypeForUrl(pages, analysis.pageUrl), observations: analysis.observations })),
    deterministicFindings: input.deterministicCandidates.map((finding) => ({ ruleKey: finding.ruleKey, category: finding.category, severity: finding.severity, url: finding.url, evidenceType: "VISIBLE_TEXT" as const, exactEvidence: finding.detectedText ?? "", explanation: finding.reason })),
  };
  let merchantAnalysis: MerchantSemanticAnalysis = { observations: [] };
  try {
    stats.merchantCalls++;
    const run = await input.analyzer.analyzeMerchant(merchantDocument);
    addUsage(stats, run.usage);
    merchantAnalysis = validateMerchantSemanticAnalysis(merchantDocument, run.result);
  } catch (error) {
    stats.failures++;
    logger.warn({ error, provider: input.analyzer.provider, model: input.analyzer.model }, "Merchant semantic analysis failed; deterministic contradiction analysis remains available");
  }
  const merchantCandidates = merchantSemanticCandidates(merchantAnalysis, pages, input.analyzer.provider, input.analyzer.model);
  stats.estimatedCostUsd = Number(stats.estimatedCostUsd.toFixed(6));
  return { candidates: [...pageCandidates, ...merchantCandidates], pageAnalyses: analyses, merchantAnalysis, stats };
}
