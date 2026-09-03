-- Store the payer identity returned by the payment processor so each merchant
-- can build a private customer directory without exposing another account.
ALTER TABLE "PaymentTransaction"
  ADD COLUMN "customerName" TEXT,
  ADD COLUMN "customerEmail" TEXT;

-- Ecwid already stores the customer email beside the matching ORBIT payment.
-- This backfill is additive and does not modify any financial fields.
UPDATE "PaymentTransaction" AS payment
SET "customerEmail" = LOWER(TRIM(session."customerEmail"))
FROM "EcwidPaymentSession" AS session
WHERE session."paymentTransactionId" = payment."id"
  AND session."customerEmail" IS NOT NULL
  AND TRIM(session."customerEmail") <> '';

CREATE INDEX "PaymentTransaction_merchantId_customerEmail_createdAt_idx"
  ON "PaymentTransaction"("merchantId", "customerEmail", "createdAt");
