-- Money movement is opt-in per user and brand. Existing grants remain read-only.
ALTER TABLE "MerchantAccess"
ADD COLUMN "canInitiatePayouts" BOOLEAN NOT NULL DEFAULT false;
