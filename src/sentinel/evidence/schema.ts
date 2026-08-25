import { z } from "zod";
import { evidenceClassifications } from "@/sentinel/analysis/evidence-classification";

export const evidenceScopes = ["MERCHANT_SITE", "EXTERNAL_PUBLIC_WEB"] as const;
export const evidenceArtifactKinds = ["PAGE_SNAPSHOT", "STRUCTURED_DATA", "PUBLIC_API", "IMAGE", "SCREENSHOT", "PDF", "DOCUMENT_TEXT", "CHECKOUT_STATE"] as const;

export const evidenceManifestRecordSchema = z.object({
  id: z.string().min(1),
  artifactId: z.string().min(1),
  scope: z.enum(evidenceScopes),
  artifactKind: z.enum(evidenceArtifactKinds),
  sourceUrl: z.string().url(),
  parentUrl: z.string().url().optional(),
  mimeType: z.string().optional(),
  httpStatus: z.number().int().optional(),
  storageKey: z.string().optional(),
  artifactMetadata: z.unknown().optional(),
  evidenceType: z.string().min(1),
  exactText: z.string().optional(),
  value: z.unknown().optional(),
  selector: z.string().optional(),
  jsonPointer: z.string().optional(),
  pageNumber: z.number().int().positive().optional(),
  sourceHash: z.string().min(1),
  artifactHash: z.string().min(1),
}).strict();

export const evidenceManifestSchema = z.object({
  version: z.literal("orbit-evidence-manifest-v1"),
  scanId: z.string().min(1),
  generatedAt: z.string().datetime(),
  records: z.array(evidenceManifestRecordSchema),
}).strict();

export const reviewEvidenceReferenceSchema = z.object({
  evidenceRecordId: z.string().min(1),
  role: z.enum(["PRIMARY", "SUPPORTING", "MITIGATING", "CONTRADICTING"]),
  classification: z.enum(evidenceClassifications),
  rationale: z.string().trim().min(1).max(2_000).nullable(),
}).strict();

export type EvidenceManifest = z.infer<typeof evidenceManifestSchema>;
export type EvidenceManifestRecord = z.infer<typeof evidenceManifestRecordSchema>;
