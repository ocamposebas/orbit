ALTER TABLE "Membership"
ADD COLUMN "portalAllMerchants" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Membership"
SET "portalAllMerchants" = true
WHERE "role" IN ('OWNER', 'ADMIN', 'ANALYST');
