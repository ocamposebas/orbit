import { z } from "zod";

export const pageTypes = ["HOME", "PRODUCT", "COLLECTION", "CATEGORY", "POLICY", "TERMS", "PRIVACY", "REFUND", "SHIPPING", "CONTACT", "FAQ", "CHECKOUT", "CART", "ACCOUNT", "BLOG", "ARTICLE", "LANDING", "COA", "OTHER"] as const;
export type SentinelPageType = (typeof pageTypes)[number];
export type SentinelSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export const linkSchema = z.object({ text: z.string(), href: z.string(), rel: z.string().optional() });
export const formSchema = z.object({ action: z.string(), method: z.string(), fields: z.array(z.object({ name: z.string(), label: z.string().default(""), type: z.string(), required: z.boolean(), checked: z.boolean().default(false), disabled: z.boolean().default(false) })) });

const locatedTextSchema = z.object({ text: z.string(), selector: z.string(), level: z.number().int().min(1).max(6).optional(), href: z.string().optional() });
const documentLinkSchema = z.object({ url: z.string(), text: z.string(), selector: z.string(), documentType: z.string() });
const productVariationSchema = z.object({ name: z.string(), sku: z.string().optional(), value: z.string().optional(), price: z.string().optional(), availability: z.string().optional() });

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
  images: z.array(z.object({ src: z.string(), filename: z.string(), alt: z.string(), title: z.string() })).default([]),
  breadcrumbs: z.array(z.string()).default([]),
  certificateLinks: z.array(z.string()).default([]),
  metadata: z.object({ title: z.string(), description: z.string(), openGraphTitle: z.string(), openGraphDescription: z.string() }).default({ title: "", description: "", openGraphTitle: "", openGraphDescription: "" }),
  controls: z.object({ ageGate: z.boolean(), cookieBanner: z.boolean(), loginWall: z.boolean(), modal: z.boolean(), researchGate: z.boolean().default(false), acknowledgementUnchecked: z.boolean().default(false), continueInitiallyDisabled: z.boolean().default(false) }),
  location: z.object({ originalUrl: z.string(), finalUrl: z.string(), pathname: z.string(), queryParams: z.record(z.string(), z.array(z.string())) }).default({ originalUrl: "", finalUrl: "", pathname: "", queryParams: {} }),
  headingRecords: z.array(locatedTextSchema).default([]),
  navigation: z.array(locatedTextSchema).default([]),
  footer: z.array(locatedTextSchema).default([]),
  linkCtas: z.array(locatedTextSchema).default([]),
  badges: z.array(locatedTextSchema).default([]),
  stockText: z.array(locatedTextSchema).default([]),
  checkoutText: z.array(locatedTextSchema).default([]),
  embeddedDocuments: z.array(documentLinkSchema).default([]),
  descriptions: z.object({ short: z.string().optional(), full: z.string().optional() }).default({}),
  productCategories: z.array(z.string()).default([]),
  productTags: z.array(z.string()).default([]),
  productVariations: z.array(productVariationSchema).default([]),
  openGraph: z.record(z.string(), z.string()).default({}),
  interactiveStates: z.array(z.object({ kind: z.string(), label: z.string(), selector: z.string() })).default([]),
  domEvidence: z.array(z.object({ text: z.string(), selector: z.string(), evidenceType: z.string() })).default([]),
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
  signalType: z.enum(["RESEARCH_RESTRICTION", "SCIENTIFIC_DISCUSSION", "HUMAN_ADMINISTRATION", "HUMAN_OUTCOME", "MEDICAL_CLAIM", "HUMAN_TESTIMONIAL", "BEFORE_AFTER_OUTCOME", "COMMERCIAL_INTENDED_USE", "PRESCRIPTION_SIGNAL", "AMBIGUOUS", "NONE"]).optional(),
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
  secondaryEvidence?: { url: string; text: string; role: string };
  supportingEvidence?: Array<{ url: string; text: string; role: string; evidenceType?: string; sourceKind?: "TEXT" | "VISUAL" | "DOCUMENT" | "INTERACTIVE"; assetStorageKey?: string; assetHash?: string; domSelector?: string; classification?: "ADVERSE" | "NEUTRAL" | "MITIGATING" | "CONTRADICTORY" | "INFORMATIONAL" }>;
  affectedUrls?: string[];
  analysisSource?: "DETERMINISTIC" | "SEMANTIC_PAGE" | "SEMANTIC_MERCHANT";
  evidenceType?: string;
  humanReviewRequired?: boolean;
  modelVersion?: string;
  provider?: string;
  semanticCategory?: string;
  semanticClassification?: string;
  promptVersion?: string;
  riskTheme?: string;
  evidenceClassification?: "ADVERSE" | "NEUTRAL" | "MITIGATING" | "CONTRADICTORY" | "INFORMATIONAL";
  prominence?: "PRIMARY_COMMERCIAL" | "PRODUCT_DESCRIPTION" | "SITEWIDE" | "NAVIGATION" | "EDITORIAL" | "TECHNICAL";
  domSelector?: string;
  sourceKind?: "TEXT" | "VISUAL" | "DOCUMENT" | "INTERACTIVE";
  assetStorageKey?: string;
  assetHash?: string;
  mitigatingEvidence?: Array<{ url: string; text: string; role: string; evidenceType?: string }>;
}

export type ScoreComponentKey = "POLICY_COVERAGE" | "PRODUCT_INTEGRITY" | "RESEARCH_CONTROLS" | "MARKETING_RISK" | "SITE_CONTROLS" | "OPERATIONAL_CONSISTENCY";

export interface ScanProgress {
  pipelineVersion: string;
  stage: "queued" | "discovering" | "crawling" | "classifying" | "analyzing" | "evidence" | "scoring" | "completed" | "failed";
  message: string;
  urlsFound: number;
  pagesProcessed: number;
  pagesTotal: number;
  productsDetected: number;
  productsDiscovered: number;
  productsScanned: number;
  variantsScanned: number;
  imagesAnalyzed: number;
  imagesDiscovered: number;
  screenshotsAnalyzed: number;
  visualPagesAnalyzed: number;
  visualCoveragePercent: number;
  certificatesDiscovered: number;
  certificatesAnalyzed: number;
  documentsDiscovered: number;
  documentsAnalyzed: number;
  documentCoveragePercent: number;
  checkoutFlowsInspected: number;
  checkoutStatesInspected: number;
  semanticPagesAnalyzed: number;
  semanticCoveragePercent: number;
  inaccessibleAreas: number;
  disclaimerPagesObserved: number;
  researchRestrictionPagesObserved: number;
  researchCoveredProducts: number;
  scanCoveragePercent: number;
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
