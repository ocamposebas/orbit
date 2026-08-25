import { z } from "zod";
import { evidenceClassifications } from "./evidence-classification";

export const semanticCategories = [
  "INTENDED_USE",
  "HUMAN_THERAPEUTIC_OUTCOME",
  "RESEARCH_POSITIONING",
  "CONTRADICTION",
  "DISCLAIMER",
  "PHARMACY_PRESCRIPTION",
  "DOSING_ADMINISTRATION",
  "MEDICAL_CLAIM",
  "QUALIFICATION_CONTROL",
  "CHECKOUT_CONTROL",
  "POLICY_COVERAGE",
  "DECEPTIVE_INCONSISTENT_POSITIONING",
] as const;

export const semanticClassifications = [
  "POSITIVE_PROMOTION",
  "RESTRICTION",
  "NEGATION",
  "CONTROL_PRESENT",
  "CONTROL_MISSING",
  "CONTRADICTION",
  "CONTEXTUAL_REVIEW",
  "NEUTRAL",
] as const;

export const semanticEvidenceTypes = [
  "TITLE",
  "META_DESCRIPTION",
  "HEADING",
  "NAVIGATION",
  "CATEGORY_COLLECTION",
  "PRODUCT_TITLE",
  "PRODUCT_DESCRIPTION",
  "CTA",
  "DISCLAIMER",
  "POLICY",
  "CHECKOUT",
  "STRUCTURED_DATA",
  "VISIBLE_TEXT",
  "FOOTER",
  "LINK_CTA",
  "BADGE",
  "STOCK",
  "IMAGE_ALT",
  "IMAGE_FILENAME",
  "PRODUCT_VARIATION",
  "VISUAL",
  "DOCUMENT",
] as const;

export type SemanticCategory = (typeof semanticCategories)[number];
export type SemanticClassification = (typeof semanticClassifications)[number];
export type SemanticEvidenceType = (typeof semanticEvidenceTypes)[number];

export const semanticEvidenceSchema = z.object({
  url: z.string().url(),
  evidenceType: z.enum(semanticEvidenceTypes),
  exactText: z.string().trim().min(1).max(2_000),
}).strict();

export const semanticObservationSchema = z.object({
  category: z.enum(semanticCategories),
  classification: z.enum(semanticClassifications),
  evidence: semanticEvidenceSchema,
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]),
  confidence: z.number().min(0).max(1),
  contextualExplanation: z.string().trim().min(1).max(2_000),
  evidenceClassification: z.enum(evidenceClassifications),
  humanReviewRequired: z.boolean(),
}).strict();

export const pageSemanticAnalysisSchema = z.object({
  pageUrl: z.string().url(),
  observations: z.array(semanticObservationSchema).max(60),
}).strict();

export const merchantSemanticObservationSchema = semanticObservationSchema.extend({
  supportingEvidence: z.array(semanticEvidenceSchema).min(1).max(12),
}).strict();

export const merchantSemanticAnalysisSchema = z.object({
  observations: z.array(merchantSemanticObservationSchema).max(40),
}).strict();

export type SemanticEvidence = z.infer<typeof semanticEvidenceSchema>;
export type SemanticObservation = z.infer<typeof semanticObservationSchema>;
export type PageSemanticAnalysis = z.infer<typeof pageSemanticAnalysisSchema>;
export type MerchantSemanticObservation = z.infer<typeof merchantSemanticObservationSchema>;
export type MerchantSemanticAnalysis = z.infer<typeof merchantSemanticAnalysisSchema>;

function strictJsonSchema(schema: z.ZodType) {
  const generated = z.toJSONSchema(schema) as Record<string, unknown>;
  delete generated.$schema;
  return generated;
}

export const pageSemanticJsonSchema = strictJsonSchema(pageSemanticAnalysisSchema);
export const merchantSemanticJsonSchema = strictJsonSchema(merchantSemanticAnalysisSchema);
