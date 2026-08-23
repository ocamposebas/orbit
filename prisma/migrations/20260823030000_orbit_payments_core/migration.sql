ALTER TABLE "Merchant" ADD COLUMN "platformFeeBps" INTEGER;

ALTER TABLE "Merchant"
ADD CONSTRAINT "Merchant_platformFeeBps_range_check"
CHECK ("platformFeeBps" IS NULL OR ("platformFeeBps" >= 0 AND "platformFeeBps" <= 10000));

-- Merchant-specific configuration requested for RGVPRIME. This is data
-- configuration, not a global application default.
UPDATE "Merchant"
SET "platformFeeBps" = 190
WHERE lower("slug") IN ('rgvprime', 'rgvprime-llc')
   OR lower("businessName") IN ('rgvprime', 'rgvprime llc');

CREATE TYPE "PaymentTransactionStatus" AS ENUM (
  'CREATED',
  'REQUIRES_PAYMENT',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCELED'
);

CREATE TABLE "PaymentTransaction" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "wooOrderId" TEXT NOT NULL,
  "stripeAccountId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "platformFeeBps" INTEGER NOT NULL,
  "platformFeeMinor" INTEGER NOT NULL,
  "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'CREATED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentTransaction_amountMinor_nonnegative_check" CHECK ("amountMinor" >= 0),
  CONSTRAINT "PaymentTransaction_platformFeeBps_range_check" CHECK ("platformFeeBps" >= 0 AND "platformFeeBps" <= 10000),
  CONSTRAINT "PaymentTransaction_platformFeeMinor_range_check" CHECK ("platformFeeMinor" >= 0 AND "platformFeeMinor" <= "amountMinor"),
  CONSTRAINT "PaymentTransaction_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX "PaymentTransaction_merchantId_wooOrderId_key"
ON "PaymentTransaction"("merchantId", "wooOrderId");

CREATE INDEX "PaymentTransaction_stripeAccountId_status_idx"
ON "PaymentTransaction"("stripeAccountId", "status");

ALTER TABLE "PaymentTransaction"
ADD CONSTRAINT "PaymentTransaction_merchantId_fkey"
FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
