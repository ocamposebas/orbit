ALTER TABLE "AiScan"
ADD COLUMN "resumeCheckpoint" JSONB NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN "resumeAfter" TIMESTAMP(3),
ADD COLUMN "resumeCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "AiScan_status_resumeAfter_idx" ON "AiScan"("status", "resumeAfter");
