-- Additive, production-safe statement snapshots. No payment processing tables are changed.
CREATE TYPE "StatementStatus" AS ENUM ('GENERATING', 'FINALIZED', 'RECONCILIATION_FAILED', 'PDF_FAILED');
CREATE TYPE "StatementEmailStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');
CREATE TYPE "StatementLineType" AS ENUM ('PAYMENT', 'REFUND', 'DISPUTE', 'PAYOUT', 'ADJUSTMENT');
ALTER TYPE "WorkerType" ADD VALUE 'STATEMENTS';

ALTER TABLE "Merchant" ADD COLUMN "monthlyStatementEmailEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "MerchantAccess" ADD COLUMN "canManageStatements" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "MerchantStatement" (
  "id" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "currency" TEXT NOT NULL,
  "status" "StatementStatus" NOT NULL DEFAULT 'GENERATING',
  "openingBalanceMinor" BIGINT NOT NULL,
  "grossPaymentsMinor" BIGINT NOT NULL,
  "refundsMinor" BIGINT NOT NULL,
  "disputesMinor" BIGINT NOT NULL,
  "processingFeesMinor" BIGINT NOT NULL,
  "orbitFeesMinor" BIGINT NOT NULL,
  "adjustmentsMinor" BIGINT NOT NULL,
  "netActivityMinor" BIGINT NOT NULL,
  "payoutsMinor" BIGINT NOT NULL,
  "closingBalanceMinor" BIGINT NOT NULL,
  "paymentCount" INTEGER NOT NULL,
  "refundCount" INTEGER NOT NULL,
  "disputeCount" INTEGER NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalizedAt" TIMESTAMP(3),
  "emailStatus" "StatementEmailStatus" NOT NULL DEFAULT 'PENDING',
  "emailAttemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastEmailAttemptAt" TIMESTAMP(3),
  "emailSentAt" TIMESTAMP(3),
  "emailMessageId" TEXT,
  "lastEmailErrorCode" TEXT,
  "pdfData" BYTEA,
  "pdfStorageReference" TEXT,
  "pdfSha256" TEXT,
  "checksum" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MerchantStatement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MerchantStatement_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "StatementLineItem" (
  "id" TEXT NOT NULL,
  "statementId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "type" "StatementLineType" NOT NULL,
  "processorType" TEXT NOT NULL,
  "reportingCategory" TEXT NOT NULL,
  "reference" TEXT,
  "description" TEXT,
  "amountMinor" BIGINT NOT NULL,
  "processingFeeMinor" BIGINT NOT NULL,
  "orbitFeeMinor" BIGINT NOT NULL,
  "netMinor" BIGINT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StatementLineItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StatementLineItem_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "MerchantStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "StatementPayout" (
  "id" TEXT NOT NULL,
  "statementId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "initiatedAt" TIMESTAMP(3) NOT NULL,
  "arrivalAt" TIMESTAMP(3),
  "status" TEXT NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "currency" TEXT NOT NULL,
  "destinationSummary" TEXT,
  CONSTRAINT "StatementPayout_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StatementPayout_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "MerchantStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "StatementDeliveryAttempt" (
  "id" TEXT NOT NULL,
  "statementId" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "status" "StatementEmailStatus" NOT NULL,
  "errorCode" TEXT,
  "messageId" TEXT,
  "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StatementDeliveryAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StatementDeliveryAttempt_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "MerchantStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MerchantStatement_publicId_key" ON "MerchantStatement"("publicId");
CREATE UNIQUE INDEX "MerchantStatement_merchantId_periodStart_currency_version_key" ON "MerchantStatement"("merchantId", "periodStart", "currency", "version");
CREATE INDEX "MerchantStatement_merchantId_periodStart_idx" ON "MerchantStatement"("merchantId", "periodStart");
CREATE INDEX "MerchantStatement_merchantId_createdAt_idx" ON "MerchantStatement"("merchantId", "createdAt");
CREATE INDEX "MerchantStatement_status_idx" ON "MerchantStatement"("status");
CREATE INDEX "MerchantStatement_emailStatus_idx" ON "MerchantStatement"("emailStatus");
CREATE UNIQUE INDEX "StatementLineItem_statementId_externalId_key" ON "StatementLineItem"("statementId", "externalId");
CREATE INDEX "StatementLineItem_statementId_occurredAt_idx" ON "StatementLineItem"("statementId", "occurredAt");
CREATE INDEX "StatementLineItem_statementId_type_idx" ON "StatementLineItem"("statementId", "type");
CREATE UNIQUE INDEX "StatementPayout_statementId_externalId_key" ON "StatementPayout"("statementId", "externalId");
CREATE INDEX "StatementPayout_statementId_initiatedAt_idx" ON "StatementPayout"("statementId", "initiatedAt");
CREATE UNIQUE INDEX "StatementDeliveryAttempt_statementId_attempt_key" ON "StatementDeliveryAttempt"("statementId", "attempt");
CREATE INDEX "StatementDeliveryAttempt_status_attemptedAt_idx" ON "StatementDeliveryAttempt"("status", "attemptedAt");
