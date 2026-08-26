-- Version 1.2 presents the total standard transfer fee as 5.9%:
-- 3.0% ORBIT platform service plus 2.9% standard Stripe processing.
-- Issued and signed agreements retain their stored version and immutable PDF.
ALTER TABLE "MerchantAgreement"
ALTER COLUMN "termsVersion" SET DEFAULT 'orbit-msa-en-1.2';

UPDATE "MerchantAgreement"
SET "termsVersion" = 'orbit-msa-en-1.2'
WHERE "termsVersion" = 'orbit-msa-en-1.1'
  AND "status" IN ('INVITED', 'DATA_COMPLETED')
  AND "contractPdf" IS NULL;
