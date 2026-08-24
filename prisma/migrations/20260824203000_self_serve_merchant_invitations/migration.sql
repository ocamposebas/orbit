-- Mark invitation-only onboarding records so merchant data can be collected from the invitee.
ALTER TABLE "MerchantAgreement" ADD COLUMN "selfServe" BOOLEAN NOT NULL DEFAULT false;
