ALTER TABLE "AiScan"
ADD COLUMN "importedReportStorageKey" TEXT,
ADD COLUMN "importedReportOriginalName" TEXT,
ADD COLUMN "importedReportMimeType" TEXT,
ADD COLUMN "importedReportSizeBytes" INTEGER,
ADD COLUMN "importedReportSha256" TEXT,
ADD COLUMN "importedReportUploadedAt" TIMESTAMP(3),
ADD COLUMN "importedReportUploadedById" TEXT,
ADD COLUMN "importedReportMetrics" JSONB NOT NULL DEFAULT '{}';
