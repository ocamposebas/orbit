-- This forward-only repair migration exists because the original self-serve
-- migration was deployed before the invitation metadata was added to it.
-- IF NOT EXISTS also keeps environments that received the later draft safe.
ALTER TABLE "MerchantAgreement"
ADD COLUMN IF NOT EXISTS "selfServe" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "MerchantAgreement"
ADD COLUMN IF NOT EXISTS "invitationIssuedAt" TIMESTAMP(3);

-- Pending invitations can safely adopt the current English agreement terms.
UPDATE "MerchantAgreement"
SET "termsVersion" = 'orbit-msa-en-1.0'
WHERE "status" = 'INVITED';

ALTER TABLE "MerchantAgreement"
ALTER COLUMN "termsVersion" SET DEFAULT 'orbit-msa-en-1.0';
