ALTER TABLE "AiScan"
ADD COLUMN "manualReportStorageKey" TEXT,
ADD COLUMN "manualReportOriginalName" TEXT,
ADD COLUMN "manualReportMimeType" TEXT,
ADD COLUMN "manualReportSizeBytes" INTEGER,
ADD COLUMN "manualReportSha256" TEXT,
ADD COLUMN "manualReportUploadedAt" TIMESTAMP(3),
ADD COLUMN "manualReportUploadedById" TEXT;
