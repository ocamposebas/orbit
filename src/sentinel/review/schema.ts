import { z } from "zod";
import { evidenceClassifications } from "@/sentinel/analysis/evidence-classification";
import { evidenceRiskThemes } from "@/sentinel/analysis/evidence-classification";
import { reviewEvidenceReferenceSchema } from "@/sentinel/evidence/schema";

export const LUNA_REVIEW_PROMPT_VERSION = "orbit-luna-holistic-v1";
export const LUNA_INDEX_PROMPT_VERSION = "orbit-luna-evidence-index-v1";
export const LUNA_CRITIC_PROMPT_VERSION = "orbit-luna-critic-v1";

export const lunaObservationSchema = z.object({
  issueKey: z.string().trim().min(3).max(200),
  domain: z.literal("SEMANTIC_CONTEXT"),
  category: z.string().trim().min(1).max(120),
  riskTheme: z.enum(evidenceRiskThemes),
  classification: z.enum(evidenceClassifications),
  conclusion: z.string().trim().min(1).max(2_000),
  confidence: z.number().min(0).max(1),
  materiality: z.enum(["MATERIAL", "NON_MATERIAL"]),
  proposedSeverity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]),
  commercialProminence: z.enum(["HIGH", "MEDIUM", "LOW"]).nullable().optional(),
  productAssociation: z.enum(["DIRECT", "CATEGORY", "EDITORIAL", "NONE"]).nullable().optional(),
  visualSignificance: z.enum(["MATERIAL", "SUPPORTING", "NONE"]).nullable().optional(),
  mitigation: z.enum(["MATERIAL", "PARTIAL", "NONE"]).nullable().optional(),
  remediation: z.string().trim().min(1).max(3_000).nullable().optional(),
  humanReviewRequired: z.boolean(),
  evidence: z.array(reviewEvidenceReferenceSchema).min(1).max(12),
  externalVerificationRequest: z.object({
    merchantClaimEvidenceId: z.string().min(1),
    claimToVerify: z.string().trim().min(1).max(1_000),
    reasonMaterial: z.string().trim().min(1).max(1_000),
  }).strict().nullable(),
}).strict();

export const lunaMerchantReviewSchema = z.object({
  version: z.literal("orbit-luna-review-v1"),
  merchantSummary: z.object({
    businessModel: z.string().trim().min(1).max(2_000),
    overallContext: z.string().trim().min(1).max(3_000),
    evidenceRecordIds: z.array(z.string().min(1)).min(1).max(30),
  }).strict(),
  observations: z.array(lunaObservationSchema).max(80),
  uncertainties: z.array(z.object({
    issueKey: z.string().trim().min(3).max(200),
    explanation: z.string().trim().min(1).max(2_000),
    evidenceRecordIds: z.array(z.string().min(1)).max(12),
  }).strict()).max(40),
}).strict();

export const criticDecisionSchema = z.object({
  version: z.literal("orbit-luna-critic-v1"),
  decisions: z.array(z.object({
    issueKey: z.string().trim().min(3).max(200),
    decision: z.enum(["SUPPORT_LUNA", "SUPPORT_VERIFIER", "INCONCLUSIVE"]),
    explanation: z.string().trim().min(1).max(2_000),
    evidenceRecordIds: z.array(z.string().min(1)).min(1).max(12),
  }).strict()).max(20),
}).strict();

function strictJsonSchema(schema: z.ZodType) {
  const generated = z.toJSONSchema(schema) as Record<string, unknown>;
  delete generated.$schema;
  const requireAllProperties = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.type === "object" && record.properties && typeof record.properties === "object") record.required = Object.keys(record.properties as Record<string, unknown>);
    for (const nested of Object.values(record)) if (Array.isArray(nested)) nested.forEach(requireAllProperties); else requireAllProperties(nested);
  };
  requireAllProperties(generated);
  return generated;
}

export const lunaMerchantReviewJsonSchema = strictJsonSchema(lunaMerchantReviewSchema);
export const criticDecisionJsonSchema = strictJsonSchema(criticDecisionSchema);
export type LunaMerchantReview = z.infer<typeof lunaMerchantReviewSchema>;
export type LunaObservation = z.infer<typeof lunaObservationSchema>;
export type CriticDecision = z.infer<typeof criticDecisionSchema>;
