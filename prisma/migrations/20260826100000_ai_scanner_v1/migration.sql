-- ORBIT AI Scanner v1 is intentionally additive. Legacy scanner tables are
-- retained for recovery and are not read by the v1 runtime.
ALTER TYPE "WorkerType" ADD VALUE IF NOT EXISTS 'AI_SCANNER';

CREATE TYPE "AiScanStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'AI_SCAN_FAILED', 'AI_SCAN_INCOMPLETE', 'CANCELLED');
CREATE TYPE "AiFailureCode" AS ENUM ('AI_SCAN_FAILED', 'AI_SCAN_INCOMPLETE');
CREATE TYPE "AiSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');
CREATE TYPE "AiMateriality" AS ENUM ('MATERIAL', 'NON_MATERIAL');
CREATE TYPE "AiEvidenceKind" AS ENUM ('PAGE_SNAPSHOT', 'VISIBLE_TEXT', 'DOM', 'LINK', 'METADATA', 'STRUCTURED_DATA', 'SCREENSHOT', 'VISUAL_REGION', 'IMAGE', 'BACKGROUND_IMAGE', 'CAROUSEL', 'PDF', 'PUBLIC_API', 'CHECKOUT_STATE', 'PRODUCT_FACT', 'CATEGORY_FACT');
CREATE TYPE "AiEvidenceRole" AS ENUM ('ADVERSE', 'MITIGATING', 'NEUTRAL');
CREATE TYPE "AiFindingStatus" AS ENUM ('OPEN', 'NEEDS_REVIEW', 'CONFIRMED', 'FALSE_POSITIVE', 'ACCEPTED_RISK', 'RESOLVED', 'IGNORED');
CREATE TYPE "AiCriticStatus" AS ENUM ('NOT_REQUESTED', 'REQUESTED', 'COMPLETED', 'FAILED');
CREATE TYPE "AiToolStatus" AS ENUM ('REQUESTED', 'COMPLETED', 'FAILED');

CREATE TABLE "AiScan" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "status" "AiScanStatus" NOT NULL DEFAULT 'QUEUED',
  "model" TEXT NOT NULL DEFAULT 'gpt-5.6-luna',
  "criticModel" TEXT,
  "budget" JSONB NOT NULL,
  "coverage" JSONB NOT NULL DEFAULT '{}',
  "usage" JSONB NOT NULL DEFAULT '{}',
  "observations" JSONB NOT NULL DEFAULT '[]',
  "summary" TEXT,
  "limitations" JSONB NOT NULL DEFAULT '[]',
  "score" INTEGER,
  "scoreBreakdown" JSONB NOT NULL DEFAULT '{}',
  "runtimeMs" INTEGER NOT NULL DEFAULT 0,
  "toolCalls" INTEGER NOT NULL DEFAULT 0,
  "failureCode" "AiFailureCode",
  "error" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiScan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiEvidence" (
  "id" TEXT NOT NULL,
  "scanId" TEXT NOT NULL,
  "toolName" TEXT NOT NULL,
  "kind" "AiEvidenceKind" NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "destinationUrl" TEXT,
  "firstParty" BOOLEAN NOT NULL DEFAULT true,
  "exactText" TEXT,
  "surroundingDom" JSONB,
  "storageKey" TEXT,
  "mimeType" TEXT,
  "sha256" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "validated" BOOLEAN NOT NULL DEFAULT false,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiFinding" (
  "id" TEXT NOT NULL,
  "scanId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "severity" "AiSeverity" NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "theme" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "materiality" "AiMateriality" NOT NULL,
  "materialityWeight" DOUBLE PRECISION NOT NULL,
  "commercialProminence" DOUBLE PRECISION NOT NULL,
  "visualProminence" DOUBLE PRECISION NOT NULL,
  "productAssociation" BOOLEAN NOT NULL DEFAULT false,
  "mitigation" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ambiguous" BOOLEAN NOT NULL DEFAULT false,
  "contradictoryEvidence" BOOLEAN NOT NULL DEFAULT false,
  "explanation" TEXT NOT NULL,
  "affectedUrl" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "affectedProduct" TEXT,
  "affectedCategory" TEXT,
  "verifiedSku" TEXT,
  "remediation" TEXT NOT NULL,
  "status" "AiFindingStatus" NOT NULL DEFAULT 'OPEN',
  "criticStatus" "AiCriticStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiFinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiFindingEvidence" (
  "id" TEXT NOT NULL,
  "findingId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "role" "AiEvidenceRole" NOT NULL,
  "rationale" TEXT,
  CONSTRAINT "AiFindingEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiProduct" (
  "id" TEXT NOT NULL,
  "scanId" TEXT NOT NULL,
  "canonicalUrl" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sku" TEXT,
  "price" TEXT,
  "currency" TEXT,
  "variants" JSONB NOT NULL DEFAULT '[]',
  "categories" JSONB NOT NULL DEFAULT '[]',
  "objectiveSignals" JSONB NOT NULL DEFAULT '{}',
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiToolEvent" (
  "id" TEXT NOT NULL,
  "scanId" TEXT NOT NULL,
  "callId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "AiToolStatus" NOT NULL DEFAULT 'REQUESTED',
  "input" JSONB NOT NULL DEFAULT '{}',
  "outputSummary" JSONB NOT NULL DEFAULT '{}',
  "evidenceCount" INTEGER NOT NULL DEFAULT 0,
  "durationMs" INTEGER,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "AiToolEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiCriticReview" (
  "id" TEXT NOT NULL,
  "scanId" TEXT NOT NULL,
  "findingId" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "status" "AiCriticStatus" NOT NULL DEFAULT 'REQUESTED',
  "result" JSONB NOT NULL DEFAULT '{}',
  "usage" JSONB NOT NULL DEFAULT '{}',
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "AiCriticReview_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AuditLog" ADD COLUMN "aiScanId" TEXT;

CREATE INDEX "AiScan_merchantId_createdAt_idx" ON "AiScan"("merchantId", "createdAt");
CREATE INDEX "AiScan_siteId_status_createdAt_idx" ON "AiScan"("siteId", "status", "createdAt");
CREATE UNIQUE INDEX "AiEvidence_scanId_sha256_key" ON "AiEvidence"("scanId", "sha256");
CREATE INDEX "AiEvidence_scanId_kind_capturedAt_idx" ON "AiEvidence"("scanId", "kind", "capturedAt");
CREATE INDEX "AiEvidence_sourceUrl_idx" ON "AiEvidence"("sourceUrl");
CREATE INDEX "AiFinding_scanId_severity_idx" ON "AiFinding"("scanId", "severity");
CREATE INDEX "AiFinding_merchantId_status_severity_idx" ON "AiFinding"("merchantId", "status", "severity");
CREATE INDEX "AiFinding_organizationId_status_idx" ON "AiFinding"("organizationId", "status");
CREATE UNIQUE INDEX "AiFindingEvidence_findingId_evidenceId_role_key" ON "AiFindingEvidence"("findingId", "evidenceId", "role");
CREATE INDEX "AiFindingEvidence_evidenceId_idx" ON "AiFindingEvidence"("evidenceId");
CREATE UNIQUE INDEX "AiProduct_scanId_canonicalUrl_key" ON "AiProduct"("scanId", "canonicalUrl");
CREATE INDEX "AiProduct_scanId_verified_idx" ON "AiProduct"("scanId", "verified");
CREATE UNIQUE INDEX "AiToolEvent_scanId_callId_key" ON "AiToolEvent"("scanId", "callId");
CREATE INDEX "AiToolEvent_scanId_startedAt_idx" ON "AiToolEvent"("scanId", "startedAt");
CREATE UNIQUE INDEX "AiCriticReview_findingId_key" ON "AiCriticReview"("findingId");
CREATE INDEX "AiCriticReview_scanId_status_idx" ON "AiCriticReview"("scanId", "status");
CREATE INDEX "AuditLog_aiScanId_createdAt_idx" ON "AuditLog"("aiScanId", "createdAt");

ALTER TABLE "AiScan" ADD CONSTRAINT "AiScan_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiScan" ADD CONSTRAINT "AiScan_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "MerchantSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiEvidence" ADD CONSTRAINT "AiEvidence_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "AiScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiFinding" ADD CONSTRAINT "AiFinding_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "AiScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiFinding" ADD CONSTRAINT "AiFinding_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiFinding" ADD CONSTRAINT "AiFinding_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiFindingEvidence" ADD CONSTRAINT "AiFindingEvidence_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "AiFinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiFindingEvidence" ADD CONSTRAINT "AiFindingEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "AiEvidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiProduct" ADD CONSTRAINT "AiProduct_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "AiScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiToolEvent" ADD CONSTRAINT "AiToolEvent_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "AiScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiCriticReview" ADD CONSTRAINT "AiCriticReview_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "AiScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiCriticReview" ADD CONSTRAINT "AiCriticReview_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "AiFinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_aiScanId_fkey" FOREIGN KEY ("aiScanId") REFERENCES "AiScan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
