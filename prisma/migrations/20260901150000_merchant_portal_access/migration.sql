ALTER TABLE "Merchant"
ADD COLUMN "portalEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "portalEnabledAt" TIMESTAMP(3);

