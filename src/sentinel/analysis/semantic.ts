import { semanticResultSchema, type SemanticResult } from "@/sentinel/types";
import { contentHash } from "@/sentinel/extraction/normalize";
import { getDatabase } from "@/sentinel/db";
import { analyzeContext } from "./contextual-signals";

export const LOCAL_SEMANTIC_VERSION = "local-semantic-v4";

export function analyzeClaim(input: string): SemanticResult {
  const text = input.trim();
  if (!text) return semanticResultSchema.parse({ classification: "neutral", risk: "none", confidence: 1, consumerDirected: false, researchContext: false, reason: "Empty text has no analyzable claim.", evidenceSpan: "" });
  const context = analyzeContext(text);
  if (context.type === "RESEARCH_RESTRICTION") return semanticResultSchema.parse({ classification: /\b(?:research use only|for research purposes only|solely|exclusively|strictly)\b/i.test(text) ? "research_context" : "neutral", risk: "none", confidence: context.confidence, consumerDirected: false, researchContext: true, reason: context.rationale, evidenceSpan: text, signalType: context.type });
  if (context.type === "SCIENTIFIC_DISCUSSION") return semanticResultSchema.parse({ classification: "research_context", risk: "none", confidence: context.confidence, consumerDirected: false, researchContext: true, reason: context.rationale, evidenceSpan: text, signalType: context.type });
  if (context.type === "HUMAN_ADMINISTRATION") return semanticResultSchema.parse({ classification: "administration_instruction", risk: context.confidence >= 0.95 ? "critical" : "high", confidence: context.confidence, consumerDirected: true, researchContext: context.researchContext, reason: context.rationale, evidenceSpan: text, signalType: context.type });
  if (["HUMAN_OUTCOME", "MEDICAL_CLAIM", "HUMAN_TESTIMONIAL", "BEFORE_AFTER_OUTCOME"].includes(context.type)) return semanticResultSchema.parse({ classification: "consumer_claim", risk: context.type === "MEDICAL_CLAIM" ? "critical" : "high", confidence: context.confidence, consumerDirected: true, researchContext: false, reason: context.rationale, evidenceSpan: text, signalType: context.type });
  if (context.type === "PRESCRIPTION_SIGNAL" || context.type === "AMBIGUOUS") return semanticResultSchema.parse({ classification: "needs_review", risk: context.type === "PRESCRIPTION_SIGNAL" ? "medium" : "low", confidence: context.confidence, consumerDirected: false, researchContext: context.researchContext, reason: context.rationale, evidenceSpan: text, signalType: context.type });
  return semanticResultSchema.parse({ classification: "neutral", risk: "none", confidence: context.confidence, consumerDirected: false, researchContext: context.researchContext, reason: context.rationale, evidenceSpan: text, signalType: context.type });
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
  readonly promptVersion = "claim-intent-v4";
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
