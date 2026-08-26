import { z } from "zod";

const evidenceReference = z.object({
  evidenceId: z.string().min(1),
  rationale: z.string().trim().min(1).max(2_000).nullable().optional(),
}).strict();

export const lunaFindingSchema = z.object({
  title: z.string().trim().min(1).max(300),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]),
  confidence: z.number().min(0).max(1),
  theme: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(160),
  materiality: z.enum(["MATERIAL", "NON_MATERIAL"]),
  materialityWeight: z.number().min(0).max(1),
  commercialProminence: z.number().min(0).max(1),
  visualProminence: z.number().min(0).max(1),
  productAssociation: z.boolean(),
  mitigation: z.number().min(0).max(1),
  ambiguous: z.boolean(),
  contradictoryEvidence: z.boolean(),
  explanation: z.string().trim().min(1).max(8_000),
  affectedUrl: z.string().url(),
  contentType: z.string().trim().min(1).max(100),
  affectedProduct: z.string().trim().min(1).max(300).nullable().optional(),
  affectedCategory: z.string().trim().min(1).max(300).nullable().optional(),
  verifiedSku: z.string().trim().min(1).max(200).nullable().optional(),
  adverseEvidence: z.array(evidenceReference).min(1).max(40),
  mitigatingEvidence: z.array(evidenceReference).max(40),
  neutralEvidence: z.array(evidenceReference).max(40),
  screenshotEvidenceIds: z.array(z.string().min(1)).max(20),
  remediation: z.string().trim().min(1).max(8_000),
}).strict();

export const lunaAuditResultSchema = z.object({
  summary: z.string().trim().min(1).max(8_000),
  observations: z.array(z.object({
    text: z.string().trim().min(1).max(4_000),
    evidenceIds: z.array(z.string().min(1)).min(1).max(30),
  }).strict()).max(100),
  findings: z.array(lunaFindingSchema).max(100),
  limitations: z.array(z.string().trim().min(1).max(2_000)).max(100),
}).strict();

export const createAiScanSchema = z.object({
  merchantId: z.string().min(1),
  siteId: z.string().min(1).optional(),
}).strict();

export const findingDecisionSchema = z.object({
  decision: z.enum(["CONFIRM", "FALSE_POSITIVE", "ACCEPT_RISK", "RESOLVE", "REOPEN", "IGNORE"]),
  note: z.string().trim().max(4_000).optional(),
}).strict();

export type LunaAuditResultInput = z.infer<typeof lunaAuditResultSchema>;

// The Responses API receives this strict JSON Schema after Luna has finished
// choosing and calling evidence tools.
export const lunaAuditJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "observations", "findings", "limitations"],
  properties: {
    summary: { type: "string" },
    observations: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "evidenceIds"],
        properties: {
          text: { type: "string" },
          evidenceIds: { type: "array", minItems: 1, maxItems: 30, items: { type: "string" } },
        },
      },
    },
    findings: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "severity", "confidence", "theme", "category", "materiality", "materialityWeight", "commercialProminence", "visualProminence", "productAssociation", "mitigation", "ambiguous", "contradictoryEvidence", "explanation", "affectedUrl", "contentType", "affectedProduct", "affectedCategory", "verifiedSku", "adverseEvidence", "mitigatingEvidence", "neutralEvidence", "screenshotEvidenceIds", "remediation"],
        properties: {
          title: { type: "string" },
          severity: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          theme: { type: "string" },
          category: { type: "string" },
          materiality: { type: "string", enum: ["MATERIAL", "NON_MATERIAL"] },
          materialityWeight: { type: "number", minimum: 0, maximum: 1 },
          commercialProminence: { type: "number", minimum: 0, maximum: 1 },
          visualProminence: { type: "number", minimum: 0, maximum: 1 },
          productAssociation: { type: "boolean" },
          mitigation: { type: "number", minimum: 0, maximum: 1 },
          ambiguous: { type: "boolean" },
          contradictoryEvidence: { type: "boolean" },
          explanation: { type: "string" },
          affectedUrl: { type: "string" },
          contentType: { type: "string" },
          affectedProduct: { type: ["string", "null"] },
          affectedCategory: { type: ["string", "null"] },
          verifiedSku: { type: ["string", "null"] },
          adverseEvidence: { type: "array", minItems: 1, maxItems: 40, items: { $ref: "#/$defs/evidenceReference" } },
          mitigatingEvidence: { type: "array", maxItems: 40, items: { $ref: "#/$defs/evidenceReference" } },
          neutralEvidence: { type: "array", maxItems: 40, items: { $ref: "#/$defs/evidenceReference" } },
          screenshotEvidenceIds: { type: "array", maxItems: 20, items: { type: "string" } },
          remediation: { type: "string" },
        },
      },
    },
    limitations: { type: "array", maxItems: 100, items: { type: "string" } },
  },
  $defs: {
    evidenceReference: {
      type: "object",
      additionalProperties: false,
      required: ["evidenceId", "rationale"],
      properties: {
        evidenceId: { type: "string" },
        rationale: { type: ["string", "null"] },
      },
    },
  },
} as const;
