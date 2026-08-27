-- Version 1.3 adds the USD 1,100 first-month activation charge, the USD 350
-- recurring charge beginning in month two, and immediate-remediation terms.
ALTER TABLE "MerchantAgreement"
ALTER COLUMN "termsVersion" SET DEFAULT 'orbit-msa-en-1.3';

-- Supersede issued but unsigned PDFs so the next download generates the current
-- terms. Signed and locked custody records remain immutable.
UPDATE "MerchantAgreement"
SET "status" = 'DATA_COMPLETED',
    "contractPdf" = NULL,
    "contractSha256" = NULL,
    "contractIssuedAt" = NULL,
    "termsVersion" = 'orbit-msa-en-1.3'
WHERE "status" = 'CONTRACT_ISSUED'
  AND "signedContract" IS NULL
  AND "lockedAt" IS NULL;

-- Pending records without a definitive PDF adopt the current version.
UPDATE "MerchantAgreement"
SET "termsVersion" = 'orbit-msa-en-1.3'
WHERE "status" IN ('INVITED', 'DATA_COMPLETED')
  AND "contractPdf" IS NULL;
