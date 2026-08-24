-- Mark invitation-only onboarding records so merchant data can be collected from the invitee.
ALTER TABLE "MerchantAgreement" ADD COLUMN "selfServe" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MerchantAgreement" ADD COLUMN "invitationIssuedAt" TIMESTAMP(3);

-- Pending invitations have not yet been certified, so they can safely adopt the English terms.
UPDATE "MerchantAgreement"
SET "termsVersion" = 'orbit-msa-en-1.0'
WHERE "status" = 'INVITED';

ALTER TABLE "MerchantAgreement" ALTER COLUMN "termsVersion" SET DEFAULT 'orbit-msa-en-1.0';
