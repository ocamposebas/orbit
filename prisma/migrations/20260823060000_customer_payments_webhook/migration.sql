ALTER TABLE "PaymentTransaction"
ADD COLUMN "wooCompletedAt" TIMESTAMP(3);

CREATE TYPE "StripePaymentEventStatus" AS ENUM (
  'PROCESSING',
  'PROCESSED',
  'IGNORED',
  'FAILED'
);

CREATE TABLE "StripePaymentEvent" (
  "id" TEXT NOT NULL,
  "stripeEventId" TEXT NOT NULL,
  "transactionId" TEXT,
  "stripePaymentIntentId" TEXT,
  "stripeAccountId" TEXT,
  "type" TEXT NOT NULL,
  "livemode" BOOLEAN NOT NULL,
  "status" "StripePaymentEventStatus" NOT NULL DEFAULT 'PROCESSING',
  "errorCode" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "StripePaymentEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StripePaymentEvent_stripeEventId_key"
ON "StripePaymentEvent"("stripeEventId");

CREATE INDEX "StripePaymentEvent_transactionId_createdAt_idx"
ON "StripePaymentEvent"("transactionId", "createdAt");

CREATE INDEX "StripePaymentEvent_stripeAccountId_status_idx"
ON "StripePaymentEvent"("stripeAccountId", "status");

ALTER TABLE "StripePaymentEvent"
ADD CONSTRAINT "StripePaymentEvent_transactionId_fkey"
FOREIGN KEY ("transactionId") REFERENCES "PaymentTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
