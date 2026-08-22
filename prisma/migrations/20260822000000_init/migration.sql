-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'ANALYST', 'REVIEWER', 'VIEWER');

-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('ONBOARDING', 'SCANNING', 'REVIEW_REQUIRED', 'READY', 'MONITORED', 'PAUSED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "SiteEnvironment" AS ENUM ('PRODUCTION', 'CHECKOUT', 'LANDING', 'SECONDARY', 'STAGING');

-- CreateEnum
CREATE TYPE "ScanMode" AS ENUM ('FULL', 'INCREMENTAL', 'QUICK', 'TARGETED');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('QUEUED', 'DISCOVERING', 'CRAWLING', 'CLASSIFYING', 'ANALYZING', 'EVIDENCE', 'SCORING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PageType" AS ENUM ('HOME', 'PRODUCT', 'COLLECTION', 'CATEGORY', 'POLICY', 'TERMS', 'PRIVACY', 'REFUND', 'SHIPPING', 'CONTACT', 'FAQ', 'CHECKOUT', 'CART', 'ACCOUNT', 'BLOG', 'ARTICLE', 'LANDING', 'COA', 'OTHER');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('OPEN', 'NEEDS_REVIEW', 'CONFIRMED', 'FALSE_POSITIVE', 'ACCEPTED_RISK', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateEnum
CREATE TYPE "EvaluationType" AS ENUM ('DETERMINISTIC', 'SEMANTIC', 'CONTRADICTION');

-- CreateEnum
CREATE TYPE "PolicyType" AS ENUM ('TERMS', 'PRIVACY', 'REFUND', 'RETURNS', 'CANCELLATION', 'SHIPPING', 'CONTACT', 'RESEARCH_USE', 'AGE', 'PROMOTION', 'OTHER');

-- CreateEnum
CREATE TYPE "PolicyCoverage" AS ENUM ('FOUND', 'MISSING', 'POTENTIALLY_INCOMPLETE', 'NEEDS_REVIEW', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "ChangeType" AS ENUM ('CONTENT_CHANGE', 'NEW_PAGE', 'REMOVED_PAGE', 'CLASSIFICATION_CHANGE');

-- CreateEnum
CREATE TYPE "RiskImpact" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('CONFIRM', 'FALSE_POSITIVE', 'ACCEPT_RISK', 'RESOLVE', 'REOPEN', 'IGNORE', 'REASSIGN', 'NOTE');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('TEXT', 'SCREENSHOT', 'VIEWPORT', 'SELECTOR', 'DOM', 'SNAPSHOT', 'DIFF');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('GENERIC');

-- CreateEnum
CREATE TYPE "WorkerType" AS ENUM ('CRAWLER', 'ANALYSIS', 'EVIDENCE');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "snapshotRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "screenshotRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "scanRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "passwordUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "businessDescription" TEXT NOT NULL,
    "expectedMonthlyVolume" TEXT,
    "status" "MerchantStatus" NOT NULL DEFAULT 'ONBOARDING',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantSite" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "environment" "SiteEnvironment" NOT NULL DEFAULT 'PRODUCTION',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastScannedAt" TIMESTAMP(3),
    "monitoringCadenceMinutes" INTEGER NOT NULL DEFAULT 1440,
    "nextScanAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "mode" "ScanMode" NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" JSONB NOT NULL DEFAULT '{}',
    "targetUrls" JSONB,
    "pagesDiscovered" INTEGER NOT NULL DEFAULT 0,
    "pagesProcessed" INTEGER NOT NULL DEFAULT 0,
    "productsDetected" INTEGER NOT NULL DEFAULT 0,
    "policiesDetected" INTEGER NOT NULL DEFAULT 0,
    "findingsCreated" INTEGER NOT NULL DEFAULT 0,
    "findingsResolved" INTEGER NOT NULL DEFAULT 0,
    "scoreBefore" INTEGER,
    "scoreAfter" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanPage" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "canonicalUrl" TEXT,
    "httpStatus" INTEGER,
    "contentType" TEXT,
    "title" TEXT,
    "metaDescription" TEXT,
    "canonicalTag" TEXT,
    "robotsDirectives" TEXT,
    "discoveredFrom" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "pageType" "PageType" NOT NULL DEFAULT 'OTHER',
    "classificationConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "classificationReasons" JSONB NOT NULL DEFAULT '[]',
    "normalizedContent" JSONB,
    "contentHash" TEXT,
    "inaccessibleReason" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageSnapshot" (
    "id" TEXT NOT NULL,
    "scanPageId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "semanticHash" TEXT,
    "normalizedContent" JSONB NOT NULL,
    "visibleText" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageChange" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "scanPageId" TEXT NOT NULL,
    "previousSnapshotId" TEXT,
    "currentSnapshotId" TEXT NOT NULL,
    "type" "ChangeType" NOT NULL,
    "riskImpact" "RiskImpact" NOT NULL DEFAULT 'NONE',
    "diff" JSONB NOT NULL,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "currentPrice" DECIMAL(12,2),
    "availability" TEXT,
    "categories" JSONB NOT NULL DEFAULT '[]',
    "disclaimers" JSONB NOT NULL DEFAULT '[]',
    "claims" JSONB NOT NULL DEFAULT '[]',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "concentration" TEXT,
    "size" TEXT,
    "price" DECIMAL(12,2),
    "availability" TEXT,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSnapshot" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "type" "PolicyType" NOT NULL,
    "coverage" "PolicyCoverage" NOT NULL,
    "url" TEXT,
    "currentHash" TEXT,
    "clauses" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicySnapshot" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "coverage" "PolicyCoverage" NOT NULL,
    "clauses" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleSet" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "industry" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "ruleSetId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleVersion" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "evaluationType" "EvaluationType" NOT NULL,
    "appliesTo" "PageType",
    "condition" JSONB NOT NULL,
    "remediationGuidance" TEXT NOT NULL,
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "sourceLastReviewed" TIMESTAMP(3),
    "jurisdiction" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "ruleVersionId" TEXT,
    "severity" "Severity" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "FindingStatus" NOT NULL DEFAULT 'OPEN',
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "pageType" "PageType" NOT NULL,
    "detectedText" TEXT,
    "reason" TEXT NOT NULL,
    "recommendedAction" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByScanId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FindingEvidence" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "kind" "EvidenceKind" NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "normalizedText" TEXT,
    "evidenceSnippet" TEXT,
    "pageHash" TEXT NOT NULL,
    "domSelector" TEXT,
    "storageKey" TEXT,
    "ruleVersion" TEXT,
    "modelVersion" TEXT,
    "classificationConfidence" DOUBLE PRECISION,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FindingEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FindingReview" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "decision" "ReviewDecision" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FindingReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Remediation" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "owner" TEXT,
    "note" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Remediation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthScore" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "formulaVersion" TEXT NOT NULL,
    "explanation" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthScoreComponent" (
    "id" TEXT NOT NULL,
    "healthScoreId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "deductions" JSONB NOT NULL,

    CONSTRAINT "HealthScoreComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "findingId" TEXT,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL DEFAULT 'GENERIC',
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "encryptedConfig" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT,
    "merchantId" TEXT,
    "scanId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "type" "WorkerType" NOT NULL,
    "status" TEXT NOT NULL,
    "currentScanId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SemanticAnalysis" (
    "id" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SemanticAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "Session_organizationId_expiresAt_idx" ON "Session"("organizationId", "expiresAt");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Merchant_organizationId_status_idx" ON "Merchant"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_organizationId_slug_key" ON "Merchant"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "MerchantSite_hostname_idx" ON "MerchantSite"("hostname");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSite_merchantId_normalizedUrl_key" ON "MerchantSite"("merchantId", "normalizedUrl");

-- CreateIndex
CREATE INDEX "Scan_merchantId_createdAt_idx" ON "Scan"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "Scan_status_createdAt_idx" ON "Scan"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ScanPage_siteId_url_idx" ON "ScanPage"("siteId", "url");

-- CreateIndex
CREATE INDEX "ScanPage_pageType_idx" ON "ScanPage"("pageType");

-- CreateIndex
CREATE UNIQUE INDEX "ScanPage_scanId_url_key" ON "ScanPage"("scanId", "url");

-- CreateIndex
CREATE INDEX "PageSnapshot_scanPageId_capturedAt_idx" ON "PageSnapshot"("scanPageId", "capturedAt");

-- CreateIndex
CREATE INDEX "PageSnapshot_contentHash_idx" ON "PageSnapshot"("contentHash");

-- CreateIndex
CREATE INDEX "PageChange_scanId_riskImpact_idx" ON "PageChange"("scanId", "riskImpact");

-- CreateIndex
CREATE UNIQUE INDEX "Product_merchantId_canonicalUrl_key" ON "Product"("merchantId", "canonicalUrl");

-- CreateIndex
CREATE INDEX "ProductSnapshot_productId_createdAt_idx" ON "ProductSnapshot"("productId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_merchantId_siteId_type_key" ON "Policy"("merchantId", "siteId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "RuleSet_code_version_key" ON "RuleSet"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Rule_ruleSetId_key_key" ON "Rule"("ruleSetId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "RuleVersion_ruleId_version_key" ON "RuleVersion"("ruleId", "version");

-- CreateIndex
CREATE INDEX "Finding_organizationId_status_severity_idx" ON "Finding"("organizationId", "status", "severity");

-- CreateIndex
CREATE INDEX "Finding_merchantId_lastDetectedAt_idx" ON "Finding"("merchantId", "lastDetectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Finding_merchantId_fingerprint_firstDetectedAt_key" ON "Finding"("merchantId", "fingerprint", "firstDetectedAt");

-- CreateIndex
CREATE INDEX "FindingEvidence_findingId_createdAt_idx" ON "FindingEvidence"("findingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HealthScore_merchantId_scanId_key" ON "HealthScore"("merchantId", "scanId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_merchantId_createdAt_idx" ON "AuditLog"("merchantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerHeartbeat_workerId_key" ON "WorkerHeartbeat"("workerId");

-- CreateIndex
CREATE UNIQUE INDEX "SemanticAnalysis_contentHash_promptVersion_provider_model_key" ON "SemanticAnalysis"("contentHash", "promptVersion", "provider", "model");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Merchant" ADD CONSTRAINT "Merchant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantSite" ADD CONSTRAINT "MerchantSite_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "MerchantSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanPage" ADD CONSTRAINT "ScanPage_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanPage" ADD CONSTRAINT "ScanPage_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "MerchantSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageSnapshot" ADD CONSTRAINT "PageSnapshot_scanPageId_fkey" FOREIGN KEY ("scanPageId") REFERENCES "ScanPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageChange" ADD CONSTRAINT "PageChange_currentSnapshotId_fkey" FOREIGN KEY ("currentSnapshotId") REFERENCES "PageSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageChange" ADD CONSTRAINT "PageChange_previousSnapshotId_fkey" FOREIGN KEY ("previousSnapshotId") REFERENCES "PageSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageChange" ADD CONSTRAINT "PageChange_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageChange" ADD CONSTRAINT "PageChange_scanPageId_fkey" FOREIGN KEY ("scanPageId") REFERENCES "ScanPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "MerchantSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSnapshot" ADD CONSTRAINT "ProductSnapshot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "MerchantSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicySnapshot" ADD CONSTRAINT "PolicySnapshot_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "RuleSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleVersion" ADD CONSTRAINT "RuleVersion_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "RuleVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "MerchantSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingEvidence" ADD CONSTRAINT "FindingEvidence_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingEvidence" ADD CONSTRAINT "FindingEvidence_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "PageSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingReview" ADD CONSTRAINT "FindingReview_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingReview" ADD CONSTRAINT "FindingReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Remediation" ADD CONSTRAINT "Remediation_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthScore" ADD CONSTRAINT "HealthScore_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthScore" ADD CONSTRAINT "HealthScore_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthScoreComponent" ADD CONSTRAINT "HealthScoreComponent_healthScoreId_fkey" FOREIGN KEY ("healthScoreId") REFERENCES "HealthScore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
