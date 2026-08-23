-- Legal country is optional for existing Sentinel-only merchants, but when
-- present it must use the ISO 3166-1 alpha-2 uppercase representation expected
-- by Stripe Accounts v2.
ALTER TABLE "Merchant" ADD COLUMN "legalCountry" TEXT;

ALTER TABLE "Merchant"
ADD CONSTRAINT "Merchant_legalCountry_iso_alpha2_check"
CHECK ("legalCountry" IS NULL OR "legalCountry" ~ '^[A-Z]{2}$');
