import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getServerEnv } from "@/sentinel/config";
import { getDatabase } from "@/sentinel/db";
import { contentHash, normalizeText } from "@/sentinel/extraction/normalize";
import { logger } from "@/sentinel/logger";
import { safeFetchBinary } from "@/sentinel/security/ssrf";
import { evidenceStorage } from "@/sentinel/storage";
import { persistArtifactEvidence } from "@/sentinel/evidence/ledger";
import type { CandidateFinding } from "@/sentinel/types";
import type { SemanticPageInput } from "./hybrid-semantic";

export const DOCUMENT_PROMPT_VERSION = "sentinel-document-v1";

const documentObservationSchema = z.object({
  category: z.enum(["VISIBLE_CLAIM", "DOCUMENT_INCONSISTENCY", "PRODUCT_MISMATCH", "DATE_OR_LOT_CONCERN", "LABORATORY_RESULT", "DOCUMENT_QUALIFICATION", "OTHER"]),
  classification: z.enum(["ADVERSE", "MITIGATING", "NEUTRAL", "INFORMATIONAL"]),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]),
  confidence: z.number().min(0).max(1),
  exactText: z.string().min(1).max(2_000),
  pageNumber: z.number().int().min(1),
  contextualExplanation: z.string().min(1).max(2_000),
  humanReviewRequired: z.boolean(),
}).strict();

export const documentSemanticAnalysisSchema = z.object({ observations: z.array(documentObservationSchema).max(30) }).strict();
export type DocumentSemanticAnalysis = z.infer<typeof documentSemanticAnalysisSchema>;

export interface ExtractedDocument {
  url: string;
  sourcePageUrl: string;
  documentType: string;
  hash: string;
  storageKey?: string;
  pageCount: number;
  pages: Array<{ pageNumber: number; text: string }>;
  metadata: {
    laboratory?: string;
    compound?: string;
    lotOrBatch?: string;
    dates: string[];
    purityOrResult?: string;
  };
}

export interface DocumentIntelligenceStats {
  discovered: number;
  extracted: number;
  semanticallyAnalyzed: number;
  cacheHits: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

const documentSystemPrompt = `You are ORBIT Sentinel's public-document observation engine.
Analyze the supplied PDF text and extracted metadata in merchant context. Return only the strict JSON schema.
Identify visible claims, internal inconsistencies, product or compound mismatches, concerning date/lot conflicts, laboratory results, and qualifications.
HPLC, purity testing, chromatograms, laboratory methods, and certificate language are technical or informational unless the document itself makes a material consumer, therapeutic, or contradictory claim.
A certificate is evidence, never proof that a merchant or product is legitimate, approved, compliant, or safe.
Copy exactText verbatim from one supplied page. Never manufacture evidence. Never decide merchant approval, compliance, legality, certification, processor eligibility, or final score.`;

function firstMatch(text: string, patterns: RegExp[]) {
  return patterns.map((pattern) => text.match(pattern)?.[1]).find(Boolean)?.trim();
}

export function extractDocumentMetadata(text: string): ExtractedDocument["metadata"] {
  const dates = [...text.matchAll(/\b(?:20\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])|(?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])[-/.]20\d{2})\b/g)].map((match) => match[0]);
  return {
    laboratory: firstMatch(text, [/(?:laboratory|lab(?:oratory)? name)\s*[:#-]\s*([^\n|]{2,100})/i, /(?:tested by|analysis by)\s+([^\n|]{2,100})/i]),
    compound: firstMatch(text, [/(?:compound|product|sample)\s*(?:name)?\s*[:#-]\s*([^\n|]{2,100})/i]),
    lotOrBatch: firstMatch(text, [/(?:lot|batch)(?:\s*(?:number|no\.?))?\s*[:#-]\s*([a-z0-9._/-]{2,80})/i]),
    dates: [...new Set(dates)].slice(0, 20),
    purityOrResult: firstMatch(text, [/(?:purity|assay|result)\s*[:#-]?\s*(\d{1,3}(?:\.\d+)?\s*%)/i]),
  };
}

export async function extractPdfDocument(input: { url: string; sourcePageUrl: string; documentType: string; scanId?: string }): Promise<ExtractedDocument> {
  const env = getServerEnv();
  const response = await safeFetchBinary(input.url, { maxBytes: Math.max(env.CRAWLER_RESPONSE_LIMIT_BYTES, 12_000_000), timeoutMs: env.AI_TIMEOUT_MS, accept: "application/pdf" });
  if (response.status >= 400 || !/(?:application\/pdf|\.pdf(?:$|[?#]))/i.test(`${response.contentType} ${response.url}`)) throw new Error("Public document did not return a PDF response");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({ data: response.bytes, useWorkerFetch: false, isEvalSupported: false }).promise;
  const pages: ExtractedDocument["pages"] = [];
  for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, env.AI_DOCUMENT_MAX_PAGES); pageNumber++) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = normalizeText(content.items.map((item) => "str" in item ? item.str : "").join(" "));
    pages.push({ pageNumber, text });
  }
  const combined = pages.map((page) => page.text).join("\n").slice(0, env.AI_DOCUMENT_MAX_CHARS);
  const hash = contentHash(response.bytes);
  const storageKey = input.scanId ? `${input.scanId}/documents/${hash}.pdf` : undefined;
  if (storageKey) await evidenceStorage().put(storageKey, response.bytes);
  return { url: response.url.toString(), sourcePageUrl: input.sourcePageUrl, documentType: input.documentType, hash, storageKey, pageCount: document.numPages, pages, metadata: extractDocumentMetadata(combined) };
}

type ProviderResponse = { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };

async function analyzeDocument(document: ExtractedDocument) {
  const env = getServerEnv();
  if (env.AI_PROVIDER !== "openai-compatible" || !env.AI_API_KEY) return undefined;
  const payload = { url: document.url, sourcePageUrl: document.sourcePageUrl, documentType: document.documentType, pageCount: document.pageCount, metadata: document.metadata, pages: document.pages.map((page) => ({ ...page, text: page.text.slice(0, Math.ceil(env.AI_DOCUMENT_MAX_CHARS / Math.max(document.pages.length, 1))) })) };
  const hash = contentHash({ prompt: DOCUMENT_PROMPT_VERSION, payload });
  const db = getDatabase();
  const cached = await db.semanticAnalysis.findUnique({ where: { contentHash_promptVersion_provider_model: { contentHash: hash, promptVersion: DOCUMENT_PROMPT_VERSION, provider: "openai-compatible-document", model: env.AI_DOCUMENT_MODEL } } });
  if (cached) return { result: documentSemanticAnalysisSchema.parse(cached.result), usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, cached: true } };
  const schema = z.toJSONSchema(documentSemanticAnalysisSchema) as Record<string, unknown>; delete schema.$schema;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);
  try {
    const response = await fetch(`${env.AI_BASE_URL.replace(/\/$/, "")}/chat/completions`, { method: "POST", signal: controller.signal, headers: { authorization: `Bearer ${env.AI_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model: env.AI_DOCUMENT_MODEL, temperature: 0, max_tokens: env.AI_MAX_OUTPUT_TOKENS, response_format: { type: "json_schema", json_schema: { name: "orbit_document_analysis", strict: true, schema } }, messages: [{ role: "system", content: documentSystemPrompt }, { role: "user", content: JSON.stringify(payload) }] }) });
    if (!response.ok) throw new Error(`Document semantic provider returned HTTP ${response.status}`);
    const raw = await response.json() as ProviderResponse;
    const content = raw.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((item) => item.text ?? "").join("") : "";
    const result = documentSemanticAnalysisSchema.parse(JSON.parse(text));
    const inputTokens = raw.usage?.prompt_tokens ?? Math.ceil(JSON.stringify(payload).length / 4);
    const outputTokens = raw.usage?.completion_tokens ?? Math.ceil(text.length / 4);
    const estimatedCostUsd = inputTokens * (env.AI_DOCUMENT_INPUT_COST_PER_MILLION ?? env.AI_INPUT_COST_PER_MILLION) / 1_000_000 + outputTokens * (env.AI_DOCUMENT_OUTPUT_COST_PER_MILLION ?? env.AI_OUTPUT_COST_PER_MILLION) / 1_000_000;
    const configuration = { temperature: 0, structuredOutput: true, usage: { inputTokens, outputTokens, estimatedCostUsd } } as unknown as Prisma.InputJsonValue;
    await db.semanticAnalysis.create({ data: { contentHash: hash, promptVersion: DOCUMENT_PROMPT_VERSION, provider: "openai-compatible-document", model: env.AI_DOCUMENT_MODEL, configuration, result: result as unknown as Prisma.InputJsonValue } });
    return { result, usage: { inputTokens, outputTokens, estimatedCostUsd, cached: false } };
  } finally { clearTimeout(timeout); }
}

function evidenceExists(document: ExtractedDocument, pageNumber: number, exactText: string) {
  const needle = normalizeText(exactText).toLowerCase();
  return document.pages.some((page) => page.pageNumber === pageNumber && normalizeText(page.text).toLowerCase().includes(needle));
}

export function documentCandidates(document: ExtractedDocument, analysis: DocumentSemanticAnalysis, model: string): CandidateFinding[] {
  return analysis.observations.flatMap((observation) => {
    if (!evidenceExists(document, observation.pageNumber, observation.exactText) || !observation.humanReviewRequired || observation.confidence < 0.7 || observation.classification !== "ADVERSE") return [];
    const criticalAllowed = observation.category === "VISIBLE_CLAIM" && /\b(?:diagnos|treat|cure|prevent|dose|inject)\w*\b/i.test(observation.exactText) && observation.confidence >= 0.9;
    const severity = observation.severity === "CRITICAL" && !criticalAllowed ? "HIGH" : observation.severity;
    return [{ ruleKey: `DOCUMENT-${observation.category}`, severity, confidence: observation.confidence, status: "NEEDS_REVIEW", category: "Document intelligence", title: observation.category === "DOCUMENT_INCONSISTENCY" || observation.category === "PRODUCT_MISMATCH" ? "Public document inconsistency requires review" : "Public document evidence requires review", description: "A public PDF or certificate contains evidence requiring contextual human review.", url: document.url, pageType: "COA", detectedText: observation.exactText, reason: observation.contextualExplanation, recommendedAction: "Compare the cited document evidence with the associated product, lot, dates, and public marketing.", scoreComponent: observation.category === "VISIBLE_CLAIM" ? "MARKETING_RISK" : "PRODUCT_INTEGRITY", analysisSource: "SEMANTIC_PAGE", evidenceType: `PDF_PAGE_${observation.pageNumber}`, humanReviewRequired: true, modelVersion: model, provider: "openai-compatible-document", semanticCategory: observation.category, semanticClassification: observation.classification, promptVersion: DOCUMENT_PROMPT_VERSION, evidenceClassification: observation.classification, prominence: "TECHNICAL", sourceKind: "DOCUMENT", assetStorageKey: document.storageKey, assetHash: document.hash, supportingEvidence: [{ url: document.sourcePageUrl, text: `Linked public ${document.documentType}: ${document.url}`, role: "document-source-link", evidenceType: "DOCUMENT_LINK" }] } satisfies CandidateFinding];
  });
}

export async function runDocumentIntelligence(scanId: string, pages: SemanticPageInput[], options: { analyzeSemantic?: boolean } = {}) {
  const env = getServerEnv();
  const links = [...new Map(pages.flatMap((page) => page.content.embeddedDocuments.map((document) => ({ ...document, sourcePageUrl: page.url }))).filter((document) => /\.pdf(?:$|[?#])/i.test(document.url)).map((document) => [document.url, document])).values()].slice(0, env.AI_DOCUMENT_MAX_FILES);
  const stats: DocumentIntelligenceStats = { discovered: links.length, extracted: 0, semanticallyAnalyzed: 0, cacheHits: 0, failures: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
  const documents: ExtractedDocument[] = [];
  const candidates: CandidateFinding[] = [];
  for (const link of links) {
    try {
      const document = await extractPdfDocument({ url: link.url, sourcePageUrl: link.sourcePageUrl, documentType: link.documentType, scanId });
      documents.push(document); stats.extracted++;
      await persistArtifactEvidence({ scanId, kind: "PDF", url: document.url, parentUrl: document.sourcePageUrl, mimeType: "application/pdf", storageKey: document.storageKey, sha256: document.hash, metadata: { documentType: document.documentType, pageCount: document.pageCount, extractedMetadata: document.metadata }, records: [{ evidenceType: "DOCUMENT_METADATA", value: document.metadata }, ...document.pages.filter((page) => page.text).map((page) => ({ evidenceType: "PDF_TEXT", exactText: page.text, pageNumber: page.pageNumber }))] });
      if (options.analyzeSemantic === false) continue;
      const run = await analyzeDocument(document);
      if (!run) continue;
      stats.semanticallyAnalyzed++;
      stats.cacheHits += Number(run.usage.cached);
      stats.inputTokens += run.usage.inputTokens;
      stats.outputTokens += run.usage.outputTokens;
      stats.estimatedCostUsd += run.usage.estimatedCostUsd;
      candidates.push(...documentCandidates(document, run.result, env.AI_DOCUMENT_MODEL));
    } catch (error) {
      stats.failures++;
      logger.warn({ error, documentUrl: link.url }, "Public document analysis failed; coverage is marked incomplete");
    }
  }
  stats.estimatedCostUsd = Number(stats.estimatedCostUsd.toFixed(6));
  return { candidates, documents, stats };
}
