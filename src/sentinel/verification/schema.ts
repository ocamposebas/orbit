import { z } from "zod";

export const VERIFIER_METHOD_VERSION = "orbit-deterministic-verifier-v1";

export const verifiedFactSchema = z.object({
  issueKey: z.string().min(1),
  factType: z.enum([
    "URL_STATUS",
    "POLICY_PRESENCE",
    "PRODUCT_COUNT",
    "STRUCTURED_DATA_COUNT",
    "CHECKOUT_CONTROLS",
    "DOCUMENT_AVAILABILITY",
    "EXACT_DUPLICATE_CONTENT",
  ]),
  subjectId: z.string().min(1),
  state: z.enum(["VERIFIED", "REFUTED", "INCONCLUSIVE"]),
  value: z.unknown(),
  evidenceRecordIds: z.array(z.string().min(1)),
}).strict();

export type VerifiedFact = z.infer<typeof verifiedFactSchema>;
