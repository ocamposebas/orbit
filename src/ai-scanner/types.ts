export const AI_SCANNER_VERSION = "orbit-ai-scanner-v1";
export const AI_SCANNER_QUEUE = "orbit-ai-scanner-v1";

export type AuditBudget = {
  maximumRuntimeMs: number;
  maximumToolCalls: number;
  maximumTokens: number;
  maximumCostUsd: number;
};

export type AuditUsage = {
  responseCalls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  approximateCostUsd: number;
};

export type PolicySurfaceType = "TERMS" | "PRIVACY" | "REFUND" | "SHIPPING" | "CONTACT" | "RESEARCH_USE" | "AGE" | "OTHER";

export type PolicyPageInspection = {
  type: PolicySurfaceType;
  url: string;
};

export type AuditCoverage = {
  urlsDiscovered: string[];
  firstPartyUrlsDiscovered: string[];
  firstPartyUrlsRemaining: string[];
  siteInventoryInspected: boolean;
  pagesOpened: string[];
  pagesVisuallyReviewed: string[];
  visualRegionsInspected: number;
  imagesInspected: number;
  categoriesInspected: string[];
  productsDiscovered: number;
  productsVerified: number;
  productPagesWithImagesInspected: string[];
  documentsInspected: string[];
  policyPagesInspected: PolicyPageInspection[];
  publicAccessGatesDismissed: string[];
  commerceSignalsObserved: boolean;
  checkoutStatesInspected: string[];
  checkoutFormsInspected: number;
  totalLunaToolCalls: number;
  auditRuntimeMs: number;
  tokenUsage: AuditUsage;
};

export type EvidenceReference = {
  evidenceId: string;
  rationale?: string;
};

export type LunaFinding = {
  title: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  confidence: number;
  theme: string;
  category: string;
  materiality: "MATERIAL" | "NON_MATERIAL";
  materialityWeight: number;
  commercialProminence: number;
  visualProminence: number;
  productAssociation: boolean;
  mitigation: number;
  ambiguous: boolean;
  contradictoryEvidence: boolean;
  explanation: string;
  affectedUrl: string;
  contentType: string;
  affectedProduct?: string | null;
  affectedCategory?: string | null;
  verifiedSku?: string | null;
  adverseEvidence: EvidenceReference[];
  mitigatingEvidence: EvidenceReference[];
  neutralEvidence: EvidenceReference[];
  screenshotEvidenceIds: string[];
  remediation: string;
};

export type LunaObservation = {
  text: string;
  evidenceIds: string[];
};

export type LunaAuditResult = {
  summary: string;
  observations: LunaObservation[];
  findings: LunaFinding[];
  limitations: string[];
};

export type ToolExecutionResult = {
  ok: boolean;
  data?: unknown;
  evidenceIds: string[];
  imageEvidenceIds?: string[];
  error?: string;
};

export type ScoreFinding = Pick<LunaFinding,
  "title" | "severity" | "confidence" | "materialityWeight" | "commercialProminence" |
  "visualProminence" | "productAssociation" | "mitigation"
>;
