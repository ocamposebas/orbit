import { semanticResultSchema, type SemanticResult } from "@/sentinel/types";
import { contentHash } from "@/sentinel/extraction/normalize";
import { getDatabase } from "@/sentinel/db";

const consumerOutcome = /\b(weight loss|fat loss|burn(?:s|ing)? fat|boosts? metabolism|suppress(?:es)? appetite|anti-aging|muscle growth|body transformation|treat(?:s|ment)?|cure[sd]?|heal(?:s|ing)?)\b/i;
const administration = /\b(inject(?:ion|ed)?|dosage|dose|take \d|twice (?:daily|weekly)|once (?:daily|weekly)|subcutaneous|intramuscular)\b/i;
const explicitNegation = /\b(?:not|never|no)\s+(?:intended|designed|recommended|approved|for)?\s*(?:for|to)?\s*(?:human use|consumption|injection|treat|cure|weight loss|fat loss)/i;
const researchLanguage = /\b(research use only|laboratory (?:analysis|research)|not for human (?:use|consumption)|preclinical|in vitro|analytical reference|research material)\b/i;

export const LOCAL_SEMANTIC_VERSION = "local-semantic-v1";

export function analyzeClaim(input: string): SemanticResult {
  const text = input.trim();
  if (!text) return semanticResultSchema.parse({ classification: "neutral", risk: "none", confidence: 1, consumerDirected: false, researchContext: false, reason: "Empty text has no analyzable claim.", evidenceSpan: "" });
  const negated = explicitNegation.test(text);
  const research = researchLanguage.test(text);
  const hasAdministration = administration.test(text);
  const hasOutcome = consumerOutcome.test(text);

  if (negated) return semanticResultSchema.parse({ classification: "neutral", risk: "none", confidence: 0.93, consumerDirected: false, researchContext: research, reason: "The relevant action or outcome is explicitly negated.", evidenceSpan: text });
  if (research && !hasAdministration) return semanticResultSchema.parse({ classification: "research_context", risk: "none", confidence: 0.9, consumerDirected: false, researchContext: true, reason: "The statement is framed as laboratory or research context rather than consumer efficacy guidance.", evidenceSpan: text });
  if (hasAdministration) return semanticResultSchema.parse({ classification: "administration_instruction", risk: "high", confidence: 0.91, consumerDirected: true, researchContext: research, reason: "The statement provides or implies administration instructions.", evidenceSpan: text });
  if (hasOutcome) return semanticResultSchema.parse({ classification: "consumer_claim", risk: "high", confidence: 0.88, consumerDirected: true, researchContext: false, reason: "The statement presents a consumer-directed efficacy or outcome claim.", evidenceSpan: text });
  return semanticResultSchema.parse({ classification: "neutral", risk: "none", confidence: 0.78, consumerDirected: false, researchContext: research, reason: "No consumer outcome or administration instruction was identified.", evidenceSpan: text });
}

export interface SemanticAnalyzer {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  analyze(text: string): Promise<SemanticResult>;
}

export class LocalSemanticAnalyzer implements SemanticAnalyzer {
  readonly provider = "local";
  readonly model = LOCAL_SEMANTIC_VERSION;
  readonly promptVersion = "claim-intent-v1";
  async analyze(text: string) { return analyzeClaim(text); }
}

export class CachedSemanticAnalyzer implements SemanticAnalyzer {
  constructor(private readonly delegate: SemanticAnalyzer) {}
  get provider() { return this.delegate.provider; }
  get model() { return this.delegate.model; }
  get promptVersion() { return this.delegate.promptVersion; }
  async analyze(text: string) {
    const hash = contentHash(text);
    const db = getDatabase();
    const cached = await db.semanticAnalysis.findUnique({ where: { contentHash_promptVersion_provider_model: { contentHash: hash, promptVersion: this.promptVersion, provider: this.provider, model: this.model } } });
    if (cached) {
      const parsed = semanticResultSchema.safeParse(cached.result);
      if (parsed.success) return parsed.data;
    }
    const result = semanticResultSchema.parse(await this.delegate.analyze(text));
    await db.semanticAnalysis.upsert({ where: { contentHash_promptVersion_provider_model: { contentHash: hash, promptVersion: this.promptVersion, provider: this.provider, model: this.model } }, update: { result }, create: { contentHash: hash, promptVersion: this.promptVersion, provider: this.provider, model: this.model, configuration: { temperature: 0, structuredOutput: true }, result } });
    return result;
  }
}
