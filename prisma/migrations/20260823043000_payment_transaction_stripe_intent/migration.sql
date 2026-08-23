ALTER TABLE "PaymentTransaction"
ADD COLUMN "stripePaymentIntentId" TEXT;

UPDATE "Merchant"
SET "platformFeeBps" = 190
WHERE lower("slug") IN ('rgvprime', 'rgvprime-llc')
   OR lower("businessName") IN ('rgvprime', 'rgvprime llc');

UPDATE "PaymentTransaction" AS transaction
SET "platformFeeBps" = 190,
    "platformFeeMinor" = ((transaction."amountMinor"::bigint * 190 + 5000) / 10000)::integer
FROM "Merchant" AS merchant
WHERE transaction."merchantId" = merchant."id"
  AND (
    lower(merchant."slug") IN ('rgvprime', 'rgvprime-llc')
    OR lower(merchant."businessName") IN ('rgvprime', 'rgvprime llc')
  );

CREATE UNIQUE INDEX "PaymentTransaction_stripePaymentIntentId_key"
ON "PaymentTransaction"("stripePaymentIntentId");
