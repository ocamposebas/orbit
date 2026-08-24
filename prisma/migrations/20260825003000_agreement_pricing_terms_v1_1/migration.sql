-- Version 1.1 adds the uniform USD 350 monthly fee and 3.0% platform fee.
ALTER TABLE "MerchantAgreement"
ALTER COLUMN "termsVersion" SET DEFAULT 'orbit-msa-en-1.1';

-- Keep the operational transaction fee aligned with the agreement for every
-- existing and future merchant. 300 basis points equals 3.0%.
ALTER TABLE "Merchant"
ALTER COLUMN "platformFeeBps" SET DEFAULT 300;

UPDATE "Merchant"
SET "platformFeeBps" = 300;

-- Supersede unsigned 1.0 PDFs so the next download generates the new pricing,
-- design and ORBIT signature. Signed and locked custody records are untouched.
UPDATE "MerchantAgreement"
SET "status" = 'DATA_COMPLETED',
    "contractPdf" = NULL,
    "contractSha256" = NULL,
    "contractIssuedAt" = NULL,
    "termsVersion" = 'orbit-msa-en-1.1'
WHERE "status" = 'CONTRACT_ISSUED'
  AND "signedContract" IS NULL
  AND "lockedAt" IS NULL;

-- Other pending records have no definitive issued PDF yet, so they can safely
-- adopt the current terms. Signed records remain immutable.
UPDATE "MerchantAgreement"
SET "termsVersion" = 'orbit-msa-en-1.1'
WHERE "status" IN ('INVITED', 'DATA_COMPLETED')
  AND "contractPdf" IS NULL;
