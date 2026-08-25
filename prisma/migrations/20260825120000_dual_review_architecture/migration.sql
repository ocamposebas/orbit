-- CreateEnum
CREATE TYPE "EvidenceScope" AS ENUM ('MERCHANT_SITE', 'EXTERNAL_PUBLIC_WEB');

-- CreateEnum
CREATE TYPE "EvidenceArtifactKind" AS ENUM ('PAGE_SNAPSHOT', 'STRUCTURED_DATA', 'PUBLIC_API', 'IMAGE', 'SCREENSHOT', 'PDF', 'DOCUMENT_TEXT', 'CHECKOUT_STATE');

-- CreateEnum
CREATE TYPE "EvidenceClassification" AS ENUM ('ADVERSE', 'MITIGATING', 'NEUTRAL', 'INFORMATIONAL');

-- CreateEnum
CREATE TYPE "ReviewRunRole" AS ENUM ('PRIMARY', 'CRITIC', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "ReviewRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AssertionDomain" AS ENUM ('SEMANTIC_CONTEXT', 'OBJECTIVE_FACT', 'MIXED');

-- CreateEnum
CREATE TYPE "ReviewMateriality" AS ENUM ('MATERIAL', 'NON_MATERIAL');

-- CreateEnum
CREATE TYPE "ReviewEvidenceRole" AS ENUM ('PRIMARY', 'SUPPORTING', 'MITIGATING', 'CONTRADICTING');

-- CreateEnum
CREATE TYPE "VerificationState" AS ENUM ('VERIFIED', 'REFUTED', 'INCONCLUSIVE');

-- CreateEnum
CREATE TYPE "AdjudicationOutcome" AS ENUM ('ACCEPTED_LUNA', 'ACCEPTED_VERIFIER', 'ACCEPTED_CRITIC', 'REJECTED', 'NEEDS_REVIEW');

-- AlterTable
ALTER TABLE "Finding" ADD COLUMN "adjudicationId" TEXT;

-- AlterTable
ALTER TABLE "FindingEvidence" ADD COLUMN "evidenceRecordId" TEXT;

-- CreateTable
CREATE TABLE "EvidenceArtifact" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "scope" "EvidenceScope" NOT NULL,
    "kind" "EvidenceArtifactKind" NOT NULL,
    "url" TEXT NOT NULL,
    "parentUrl" TEXT,
    "mimeType" TEXT,
    "httpStatus" INTEGER,
    "storageKey" TEXT,
    "sha256" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceRecord" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "exactText" TEXT,
    "value" JSONB,
    "selector" TEXT,
    "jsonPointer" TEXT,
    "pageNumber" INTEGER,
    "coordinates" JSONB,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewRun" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "role" "ReviewRunRole" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputManifestHash" TEXT NOT NULL,
    "status" "ReviewRunStatus" NOT NULL DEFAULT 'RUNNING',
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "usage" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ReviewRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewObservation" (
    "id" TEXT NOT NULL,
    "reviewRunId" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "domain" "AssertionDomain" NOT NULL,
    "category" TEXT NOT NULL,
    "riskTheme" TEXT NOT NULL,
    "classification" "EvidenceClassification" NOT NULL,
    "conclusion" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "materiality" "ReviewMateriality" NOT NULL,
    "proposedSeverity" "Severity",
    "humanReviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewEvidenceLink" (
    "id" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "evidenceRecordId" TEXT NOT NULL,
    "role" "ReviewEvidenceRole" NOT NULL,
    "classification" "EvidenceClassification" NOT NULL,
    "rationale" TEXT,

    CONSTRAINT "ReviewEvidenceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationAssertion" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "factType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "state" "VerificationState" NOT NULL,
    "value" JSONB NOT NULL DEFAULT '{}',
    "methodVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationAssertion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationEvidenceLink" (
    "id" TEXT NOT NULL,
    "verificationAssertionId" TEXT NOT NULL,
    "evidenceRecordId" TEXT NOT NULL,

    CONSTRAINT "VerificationEvidenceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdjudicationDecision" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "domain" "AssertionDomain" NOT NULL,
    "material" BOOLEAN NOT NULL,
    "outcome" "AdjudicationOutcome" NOT NULL,
    "reason" TEXT NOT NULL,
    "scoreEligible" BOOLEAN NOT NULL DEFAULT false,
    "primaryObservationId" TEXT,
    "verificationAssertionId" TEXT,
    "criticRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdjudicationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceArtifact_scanId_scope_kind_url_sha256_key" ON "EvidenceArtifact"("scanId", "scope", "kind", "url", "sha256");
CREATE INDEX "EvidenceArtifact_scanId_scope_kind_idx" ON "EvidenceArtifact"("scanId", "scope", "kind");
CREATE INDEX "EvidenceArtifact_sha256_idx" ON "EvidenceArtifact"("sha256");
CREATE UNIQUE INDEX "EvidenceRecord_artifactId_evidenceType_contentHash_key" ON "EvidenceRecord"("artifactId", "evidenceType", "contentHash");
CREATE INDEX "EvidenceRecord_artifactId_evidenceType_idx" ON "EvidenceRecord"("artifactId", "evidenceType");
CREATE INDEX "EvidenceRecord_contentHash_idx" ON "EvidenceRecord"("contentHash");
CREATE INDEX "ReviewRun_scanId_role_createdAt_idx" ON "ReviewRun"("scanId", "role", "createdAt");
CREATE INDEX "ReviewRun_inputManifestHash_promptVersion_model_idx" ON "ReviewRun"("inputManifestHash", "promptVersion", "model");
CREATE UNIQUE INDEX "ReviewObservation_reviewRunId_issueKey_key" ON "ReviewObservation"("reviewRunId", "issueKey");
CREATE INDEX "ReviewObservation_issueKey_classification_idx" ON "ReviewObservation"("issueKey", "classification");
CREATE UNIQUE INDEX "ReviewEvidenceLink_observationId_evidenceRecordId_role_key" ON "ReviewEvidenceLink"("observationId", "evidenceRecordId", "role");
CREATE INDEX "ReviewEvidenceLink_evidenceRecordId_idx" ON "ReviewEvidenceLink"("evidenceRecordId");
CREATE UNIQUE INDEX "VerificationAssertion_scanId_issueKey_methodVersion_key" ON "VerificationAssertion"("scanId", "issueKey", "methodVersion");
CREATE INDEX "VerificationAssertion_scanId_factType_state_idx" ON "VerificationAssertion"("scanId", "factType", "state");
CREATE UNIQUE INDEX "VerificationEvidenceLink_verificationAssertionId_evidenceRecordId_key" ON "VerificationEvidenceLink"("verificationAssertionId", "evidenceRecordId");
CREATE INDEX "VerificationEvidenceLink_evidenceRecordId_idx" ON "VerificationEvidenceLink"("evidenceRecordId");
CREATE UNIQUE INDEX "AdjudicationDecision_scanId_issueKey_key" ON "AdjudicationDecision"("scanId", "issueKey");
CREATE INDEX "AdjudicationDecision_scanId_outcome_scoreEligible_idx" ON "AdjudicationDecision"("scanId", "outcome", "scoreEligible");
CREATE UNIQUE INDEX "Finding_adjudicationId_key" ON "Finding"("adjudicationId");
CREATE INDEX "FindingEvidence_evidenceRecordId_idx" ON "FindingEvidence"("evidenceRecordId");

-- AddForeignKey
ALTER TABLE "EvidenceArtifact" ADD CONSTRAINT "EvidenceArtifact_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "EvidenceArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewRun" ADD CONSTRAINT "ReviewRun_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewObservation" ADD CONSTRAINT "ReviewObservation_reviewRunId_fkey" FOREIGN KEY ("reviewRunId") REFERENCES "ReviewRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewEvidenceLink" ADD CONSTRAINT "ReviewEvidenceLink_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "ReviewObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewEvidenceLink" ADD CONSTRAINT "ReviewEvidenceLink_evidenceRecordId_fkey" FOREIGN KEY ("evidenceRecordId") REFERENCES "EvidenceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VerificationAssertion" ADD CONSTRAINT "VerificationAssertion_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VerificationEvidenceLink" ADD CONSTRAINT "VerificationEvidenceLink_verificationAssertionId_fkey" FOREIGN KEY ("verificationAssertionId") REFERENCES "VerificationAssertion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VerificationEvidenceLink" ADD CONSTRAINT "VerificationEvidenceLink_evidenceRecordId_fkey" FOREIGN KEY ("evidenceRecordId") REFERENCES "EvidenceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdjudicationDecision" ADD CONSTRAINT "AdjudicationDecision_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdjudicationDecision" ADD CONSTRAINT "AdjudicationDecision_primaryObservationId_fkey" FOREIGN KEY ("primaryObservationId") REFERENCES "ReviewObservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AdjudicationDecision" ADD CONSTRAINT "AdjudicationDecision_verificationAssertionId_fkey" FOREIGN KEY ("verificationAssertionId") REFERENCES "VerificationAssertion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AdjudicationDecision" ADD CONSTRAINT "AdjudicationDecision_criticRunId_fkey" FOREIGN KEY ("criticRunId") REFERENCES "ReviewRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_adjudicationId_fkey" FOREIGN KEY ("adjudicationId") REFERENCES "AdjudicationDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FindingEvidence" ADD CONSTRAINT "FindingEvidence_evidenceRecordId_fkey" FOREIGN KEY ("evidenceRecordId") REFERENCES "EvidenceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
