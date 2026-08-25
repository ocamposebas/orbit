import type { CandidateFinding, NormalizedContent, ScoreComponentKey, SentinelPageType, SentinelSeverity } from "@/sentinel/types";
import { splitSentences } from "@/sentinel/extraction/normalize";
import { logger } from "@/sentinel/logger";
import { analyzeContext } from "./contextual-signals";
import { classifyEvidenceRecord, classifyTextEvidence, materiallyConflictingThemes, type EvidenceClassification } from "./evidence-classification";
import { semanticEvidenceTypes, type MerchantSemanticAnalysis, type MerchantSemanticObservation, type PageSemanticAnalysis, type SemanticEvidence, type SemanticEvidenceType, type SemanticObservation } from "./semantic-schema";
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
const standaloneQuestion = /^(?:can|could|should|would|what|which|who|when|where|why|how|is|are|do|does|did|may|might)\b[^.]{0,2000}\?$/i;

function normalized(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function addEvidence(target: SemanticEvidenceItemWithKey[], evidenceType: SemanticEvidenceType, text: string | undefined, details: { selector?: string; prominence?: string } = {}) {
  const clean = text?.replace(/\s+/g, " ").trim();
  if (!clean) return;
  const key = `${evidenceType}|${clean.toLowerCase()}`;
  if (!target.some((item) => item.key === key)) target.push({ key, evidenceType, text: clean.slice(0, 2_000), ...details });
}

type SemanticEvidenceItemWithKey = PageSemanticDocument["evidenceItems"][number] & { key: string };

export function buildPageSemanticDocument(page: SemanticPageInput, maxChars = 24_000): PageSemanticDocument {
  const items: SemanticEvidenceItemWithKey[] = [];
  addEvidence(items, "TITLE", page.content.title);
  addEvidence(items, "TITLE", page.content.metadata.title);
  addEvidence(items, "TITLE", page.content.metadata.openGraphTitle);
  addEvidence(items, "META_DESCRIPTION", page.content.metadata.description);
  addEvidence(items, "META_DESCRIPTION", page.content.metadata.openGraphDescription);
  const headings = page.content.headingRecords.length ? page.content.headingRecords : page.content.headings.map((text) => ({ text, selector: "", level: undefined }));
  for (const heading of headings) addEvidence(items, "HEADING", heading.text, { selector: heading.selector, prominence: heading.level === 1 ? "PRIMARY_COMMERCIAL" : "SITEWIDE" });
  for (const link of page.content.navigation) {
    addEvidence(items, "NAVIGATION", link.text, { selector: link.selector, prominence: "NAVIGATION" });
    if (/\/(?:collections?|categor(?:y|ies))\//i.test(link.href ?? "")) addEvidence(items, "CATEGORY_COLLECTION", link.text, { selector: link.selector, prominence: "PRIMARY_COMMERCIAL" });
  }
  if (page.pageType === "CATEGORY" || page.pageType === "COLLECTION") {
    addEvidence(items, "CATEGORY_COLLECTION", page.content.title);
    for (const heading of page.content.headings) addEvidence(items, "CATEGORY_COLLECTION", heading);
  }
  for (const breadcrumb of page.content.breadcrumbs) addEvidence(items, "CATEGORY_COLLECTION", breadcrumb);
  addEvidence(items, "PRODUCT_TITLE", page.content.productName);
  if (page.pageType === "PRODUCT") {
    addEvidence(items, "PRODUCT_DESCRIPTION", page.content.descriptions.short, { prominence: "PRODUCT_DESCRIPTION" });
    addEvidence(items, "PRODUCT_DESCRIPTION", page.content.descriptions.full, { prominence: "PRODUCT_DESCRIPTION" });
    for (const paragraph of page.content.paragraphs) addEvidence(items, "PRODUCT_DESCRIPTION", paragraph, { prominence: "PRODUCT_DESCRIPTION" });
    for (const variation of page.content.productVariations) addEvidence(items, "PRODUCT_VARIATION", [variation.name, variation.sku, variation.price, variation.availability].filter(Boolean).join(" | "), { prominence: "PRIMARY_COMMERCIAL" });
  }
  for (const button of page.content.buttons) addEvidence(items, "CTA", button);
  for (const cta of page.content.linkCtas) addEvidence(items, "LINK_CTA", cta.text, { selector: cta.selector, prominence: "PRIMARY_COMMERCIAL" });
  for (const badge of page.content.badges) addEvidence(items, "BADGE", badge.text, { selector: badge.selector, prominence: "PRIMARY_COMMERCIAL" });
  for (const stock of page.content.stockText) addEvidence(items, "STOCK", stock.text, { selector: stock.selector, prominence: "PRIMARY_COMMERCIAL" });
  for (const footer of page.content.footer) addEvidence(items, "FOOTER", footer.text, { selector: footer.selector, prominence: "SITEWIDE" });
  for (const image of page.content.images) {
    addEvidence(items, "IMAGE_ALT", image.alt, { prominence: page.pageType === "PRODUCT" ? "PRIMARY_COMMERCIAL" : "SITEWIDE" });
    addEvidence(items, "IMAGE_FILENAME", image.filename, { prominence: "TECHNICAL" });
  }
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
    bounded.push({ evidenceType: item.evidenceType, text, selector: item.selector, prominence: item.prominence });
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

function classifiedObservation<T extends SemanticObservation>(observation: T): T {
  const textClassification = classifyEvidenceRecord({ text: observation.evidence.exactText, evidenceType: observation.evidence.evidenceType, proposedClassification: observation.evidenceClassification });
  let evidenceClassification: EvidenceClassification = textClassification;
  if (["RESTRICTION", "NEGATION", "CONTROL_PRESENT"].includes(observation.classification)) evidenceClassification = "MITIGATING";
  else if (observation.classification === "NEUTRAL") evidenceClassification = textClassification === "INFORMATIONAL" ? "INFORMATIONAL" : "NEUTRAL";
  else if (observation.classification === "CONTROL_MISSING") evidenceClassification = "ADVERSE";
  else if (textClassification !== "ADVERSE") evidenceClassification = textClassification;
  else evidenceClassification = "ADVERSE";
  return { ...observation, evidenceClassification };
}

export function validatePageSemanticAnalysis(document: PageSemanticDocument, analysis: PageSemanticAnalysis): PageSemanticAnalysis {
  if (analysis.pageUrl !== document.pageUrl) return { pageUrl: document.pageUrl, observations: [] };
  const inventory = document.evidenceItems.map((item) => ({ url: document.pageUrl, ...item }));
  const observations = analysis.observations.map(classifiedObservation).filter((observation) => {
    if (!evidenceExists(observation.evidence, inventory)) return false;
    if (!riskyClassifications.has(observation.classification)) return true;
    if (observation.evidenceClassification !== "ADVERSE") return false;
    if (standaloneQuestion.test(observation.evidence.exactText.trim())) return false;
    const context = analyzeContext(observation.evidence.exactText);
    return context.material || (context.type !== "RESEARCH_RESTRICTION" && context.type !== "SCIENTIFIC_DISCUSSION");
  });
  return { pageUrl: document.pageUrl, observations: deduplicateObservations(observations) };
}

function merchantInventory(document: MerchantSemanticDocument) {
  const fromPages = document.pages.flatMap((page) => page.observations.map((observation) => observation.evidence));
  const fromRules = document.deterministicFindings.filter((finding) => finding.exactEvidence).map((finding) => ({ url: finding.url, evidenceType: finding.evidenceType, exactText: finding.exactEvidence }));
  return [...fromPages, ...fromRules].map((evidence) => ({ url: evidence.url, evidenceType: evidence.evidenceType, text: evidence.exactText }));
}

type EvidencePolarity = "MATERIAL_RISK" | "RESTRICTION" | "OTHER";

function sameEvidence(left: SemanticEvidence, right: SemanticEvidence) {
  return left.url === right.url && left.evidenceType === right.evidenceType && normalized(left.exactText) === normalized(right.exactText);
}

function evidencePolarity(document: MerchantSemanticDocument, evidence: SemanticEvidence): EvidencePolarity {
  const pageMatches = document.pages.flatMap((page) => page.observations).filter((observation) => sameEvidence(observation.evidence, evidence));
  if (pageMatches.some((observation) => observation.evidenceClassification === "MITIGATING")) return "RESTRICTION";
  if (pageMatches.some((observation) => observation.evidenceClassification === "ADVERSE")) return "MATERIAL_RISK";
  const ruleMatches = document.deterministicFindings.filter((finding) => finding.url === evidence.url && finding.evidenceType === evidence.evidenceType && normalized(finding.exactEvidence) === normalized(evidence.exactText));
  const textClassification = classifyTextEvidence(evidence.exactText);
  if (ruleMatches.some((finding) => finding.polarity === "RESTRICTION") || textClassification === "MITIGATING") return "RESTRICTION";
  if (ruleMatches.some((finding) => finding.polarity === "MATERIAL_RISK") && textClassification === "ADVERSE") return "MATERIAL_RISK";
  return "OTHER";
}

function supportsCriticalContradiction(document: MerchantSemanticDocument, evidence: SemanticEvidence) {
  const pageCritical = document.pages.flatMap((page) => page.observations).some((observation) => sameEvidence(observation.evidence, evidence) && observation.severity === "CRITICAL" && ["MEDICAL_CLAIM", "DOSING_ADMINISTRATION"].includes(observation.category) && ["POSITIVE_PROMOTION", "CONTEXTUAL_REVIEW"].includes(observation.classification));
  const ruleCritical = document.deterministicFindings.some((finding) => finding.url === evidence.url && normalized(finding.exactEvidence) === normalized(evidence.exactText) && finding.polarity === "MATERIAL_RISK" && finding.severity === "CRITICAL");
  return pageCritical || ruleCritical;
}

export function validateMerchantSemanticAnalysis(document: MerchantSemanticDocument, analysis: MerchantSemanticAnalysis): MerchantSemanticAnalysis {
  const inventory = merchantInventory(document);
  const observations = analysis.observations.map(classifiedObservation).flatMap((observation) => {
    if (!evidenceExists(observation.evidence, inventory) || !observation.supportingEvidence.every((evidence) => evidenceExists(evidence, inventory))) return [];
    const evidenceSet = [observation.evidence, ...observation.supportingEvidence].filter((evidence, index, all) => all.findIndex((item) => sameEvidence(item, evidence)) === index);
    const contradiction = observation.classification === "CONTRADICTION" || observation.category === "CONTRADICTION" || observation.category === "DECEPTIVE_INCONSISTENT_POSITIONING";
    if (!contradiction) return [observation];
    const riskEvidence = evidenceSet.find((evidence) => evidencePolarity(document, evidence) === "MATERIAL_RISK");
    const restrictionEvidence = evidenceSet.find((evidence) => evidencePolarity(document, evidence) === "RESTRICTION");
    if (!riskEvidence || !restrictionEvidence || sameEvidence(riskEvidence, restrictionEvidence) || !materiallyConflictingThemes(riskEvidence.exactText, restrictionEvidence.exactText)) return [];
    const supportingEvidence = [restrictionEvidence, ...evidenceSet.filter((evidence) => !sameEvidence(evidence, riskEvidence) && !sameEvidence(evidence, restrictionEvidence))];
    const severity = observation.severity === "CRITICAL" && !supportsCriticalContradiction(document, riskEvidence) ? "HIGH" as const : observation.severity;
    return [{ ...observation, evidence: riskEvidence, supportingEvidence, severity }];
  });
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
  if (observation.evidenceClassification !== "ADVERSE" || !riskyClassifications.has(observation.classification) || !observation.humanReviewRequired || observation.confidence < 0.7) return undefined;
  const prefix = source === "SEMANTIC_PAGE" ? "SEM-PAGE" : "SEM-MERCHANT";
  const sourcePage = pages.find((page) => page.url === observation.evidence.url);
  const inventory = sourcePage ? buildPageSemanticDocument(sourcePage).evidenceItems : [];
  const sourceItem = inventory.find((item) => item.evidenceType === observation.evidence.evidenceType && normalized(item.text).includes(normalized(observation.evidence.exactText)));
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
    evidenceClassification: observation.evidenceClassification,
    prominence: (sourceItem?.prominence as CandidateFinding["prominence"]) ?? (pageTypeForUrl(pages, observation.evidence.url) === "ARTICLE" ? "EDITORIAL" : "SITEWIDE"),
    domSelector: sourceItem?.selector,
    sourceKind: "TEXT",
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
    return [{ ...candidate, supportingEvidence: observation.supportingEvidence.map((evidence) => ({ url: evidence.url, text: evidence.exactText, role: "supporting-semantic-evidence", evidenceType: evidence.evidenceType, classification: classifyTextEvidence(evidence.exactText) })) }];
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

export async function runHybridSemanticAnalysis(input: { analyzer: WebsiteSemanticAnalyzer; pages: SemanticPageInput[]; merchantName: string; deterministicCandidates: CandidateFinding[]; concurrency?: number; maxPageChars?: number; skipMerchant?: boolean }) {
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
  if (input.skipMerchant) return { candidates: pageCandidates, pageCandidates, pageAnalyses: analyses, merchantAnalysis: { observations: [] } as MerchantSemanticAnalysis, stats };
  const merchant = await runMerchantSemanticPass({ analyzer: input.analyzer, pages, merchantName: input.merchantName, pageAnalyses: analyses, candidates: input.deterministicCandidates });
  stats.merchantCalls += merchant.stats.merchantCalls;
  stats.cacheHits += merchant.stats.cacheHits;
  stats.failures += merchant.stats.failures;
  stats.inputTokens += merchant.stats.inputTokens;
  stats.outputTokens += merchant.stats.outputTokens;
  stats.estimatedCostUsd += merchant.stats.estimatedCostUsd;
  const merchantCandidates = merchantSemanticCandidates(merchant.analysis, pages, input.analyzer.provider, input.analyzer.model);
  stats.estimatedCostUsd = Number(stats.estimatedCostUsd.toFixed(6));
  return { candidates: [...pageCandidates, ...merchantCandidates], pageCandidates, pageAnalyses: analyses, merchantAnalysis: merchant.analysis, stats };
}

function candidateEvidenceType(candidate: CandidateFinding): SemanticEvidenceType {
  if (candidate.sourceKind === "VISUAL") return "VISUAL";
  if (candidate.sourceKind === "DOCUMENT") return "DOCUMENT";
  return semanticEvidenceTypes.includes(candidate.evidenceType as SemanticEvidenceType) ? candidate.evidenceType as SemanticEvidenceType : "VISIBLE_TEXT";
}

export async function runMerchantSemanticPass(input: { analyzer: WebsiteSemanticAnalyzer; pages: SemanticPageInput[]; merchantName: string; pageAnalyses: PageSemanticAnalysis[]; candidates: CandidateFinding[] }) {
  const stats = { merchantCalls: 0, cacheHits: 0, failures: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
  const merchantDocument: MerchantSemanticDocument = {
    merchantName: input.merchantName,
    pages: input.pageAnalyses.map((analysis) => ({ pageUrl: analysis.pageUrl, pageType: pageTypeForUrl(input.pages, analysis.pageUrl), observations: analysis.observations })),
    deterministicFindings: input.candidates.map((finding) => {
      const exactEvidence = finding.detectedText ?? "";
      const context = analyzeContext(exactEvidence);
      const evidenceClassification = classifyTextEvidence(exactEvidence);
      const polarity = context.type === "RESEARCH_RESTRICTION" || evidenceClassification === "MITIGATING" ? "RESTRICTION" as const : evidenceClassification === "ADVERSE" && (finding.scoreComponent === "MARKETING_RISK" || /^(?:RSRCH-ADMIN|RX-REVIEW|POSITION-COSMETIC)/.test(finding.ruleKey)) ? "MATERIAL_RISK" as const : "OTHER" as const;
      return { ruleKey: finding.ruleKey, category: finding.category, severity: finding.severity, url: finding.url, evidenceType: candidateEvidenceType(finding), exactEvidence, explanation: finding.reason, polarity };
    }),
  };
  let merchantAnalysis: MerchantSemanticAnalysis = { observations: [] };
  try {
    stats.merchantCalls++;
    const run = await input.analyzer.analyzeMerchant(merchantDocument);
    stats.cacheHits += Number(run.usage.cached); stats.inputTokens += run.usage.inputTokens; stats.outputTokens += run.usage.outputTokens; stats.estimatedCostUsd += run.usage.estimatedCostUsd;
    merchantAnalysis = validateMerchantSemanticAnalysis(merchantDocument, run.result);
  } catch (error) {
    stats.failures++;
    logger.warn({ error, provider: input.analyzer.provider, model: input.analyzer.model }, "Merchant semantic analysis failed; deterministic contradiction analysis remains available");
  }
  return { analysis: merchantAnalysis, stats };
}
