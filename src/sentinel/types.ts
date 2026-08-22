import { z } from "zod";

export const pageTypes = ["HOME", "PRODUCT", "COLLECTION", "CATEGORY", "POLICY", "TERMS", "PRIVACY", "REFUND", "SHIPPING", "CONTACT", "FAQ", "CHECKOUT", "CART", "ACCOUNT", "BLOG", "ARTICLE", "LANDING", "COA", "OTHER"] as const;
export type SentinelPageType = (typeof pageTypes)[number];
export type SentinelSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export const linkSchema = z.object({ text: z.string(), href: z.string(), rel: z.string().optional() });
export const formSchema = z.object({ action: z.string(), method: z.string(), fields: z.array(z.object({ name: z.string(), type: z.string(), required: z.boolean() })) });

export const normalizedContentSchema = z.object({
  title: z.string(),
  headings: z.array(z.string()),
  paragraphs: z.array(z.string()),
  visibleText: z.string(),
  buttons: z.array(z.string()),
  links: z.array(linkSchema),
  forms: z.array(formSchema),
  structuredData: z.array(z.unknown()),
  prices: z.array(z.string()),
  productName: z.string().optional(),
  sku: z.string().optional(),
  variants: z.array(z.string()),
  claims: z.array(z.string()),
  disclaimers: z.array(z.string()),
  technologies: z.array(z.string()),
  controls: z.object({ ageGate: z.boolean(), cookieBanner: z.boolean(), loginWall: z.boolean(), modal: z.boolean() }),
});

export type NormalizedContent = z.infer<typeof normalizedContentSchema>;

export const semanticResultSchema = z.object({
  classification: z.enum(["consumer_claim", "research_context", "administration_instruction", "neutral", "needs_review"]),
  risk: z.enum(["critical", "high", "medium", "low", "none"]),
  confidence: z.number().min(0).max(1),
  consumerDirected: z.boolean(),
  researchContext: z.boolean(),
  reason: z.string().min(1),
  evidenceSpan: z.string(),
});

export type SemanticResult = z.infer<typeof semanticResultSchema>;

export interface ClassifiedPage {
  pageType: SentinelPageType;
  confidence: number;
  reasons: string[];
}

export interface CandidateFinding {
  ruleKey: string;
  severity: SentinelSeverity;
  confidence: number;
  status: "OPEN" | "NEEDS_REVIEW";
  category: string;
  title: string;
  description: string;
  url: string;
  pageType: SentinelPageType;
  detectedText?: string;
  reason: string;
  recommendedAction: string;
  scoreComponent: ScoreComponentKey;
}

export type ScoreComponentKey = "POLICY_COVERAGE" | "PRODUCT_INTEGRITY" | "RESEARCH_CONTROLS" | "MARKETING_RISK" | "SITE_CONTROLS" | "OPERATIONAL_CONSISTENCY";

export interface ScanProgress {
  stage: "queued" | "discovering" | "crawling" | "classifying" | "analyzing" | "evidence" | "scoring" | "completed" | "failed";
  message: string;
  urlsFound: number;
  pagesProcessed: number;
  pagesTotal: number;
  productsDetected: number;
  policiesDetected: number;
  claimsInspected: number;
  findings: number;
  attempt: number;
  recoveredPages: number;
  stageProcessed: number;
  stageTotal: number;
  currentUrl?: string;
  updatedAt: string;
}
