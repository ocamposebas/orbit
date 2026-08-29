CREATE TYPE "PaymentSource" AS ENUM ('WOOCOMMERCE', 'ECWID');
CREATE TYPE "EcwidPaymentSessionStatus" AS ENUM (
    'PENDING',
    'PAID_SYNC_PENDING',
    'PAID_SYNCED',
    'INCOMPLETE_SYNC_PENDING',
    'INCOMPLETE_SYNCED'
);

ALTER TABLE "PaymentTransaction"
ADD COLUMN "source" "PaymentSource" NOT NULL DEFAULT 'WOOCOMMERCE',
ADD COLUMN "externalReference" TEXT;

CREATE INDEX "PaymentTransaction_source_status_idx"
ON "PaymentTransaction"("source", "status");

CREATE TABLE "EcwidPaymentSession" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "paymentTransactionId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "referenceTransactionId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "customerEmail" TEXT,
    "encryptedReturnUrl" TEXT NOT NULL,
    "status" "EcwidPaymentSessionStatus" NOT NULL DEFAULT 'PENDING',
    "ecwidPaymentStatus" TEXT,
    "syncAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextSyncAt" TIMESTAMP(3),
    "lastSyncErrorCode" TEXT,
    "syncedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EcwidPaymentSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EcwidPaymentSession_amountMinor_positive_check" CHECK ("amountMinor" > 0),
    CONSTRAINT "EcwidPaymentSession_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX "EcwidPaymentSession_paymentTransactionId_key"
ON "EcwidPaymentSession"("paymentTransactionId");

CREATE UNIQUE INDEX "EcwidPaymentSession_storeId_referenceTransactionId_key"
ON "EcwidPaymentSession"("storeId", "referenceTransactionId");

CREATE INDEX "EcwidPaymentSession_status_nextSyncAt_idx"
ON "EcwidPaymentSession"("status", "nextSyncAt");

CREATE INDEX "EcwidPaymentSession_merchantId_createdAt_idx"
ON "EcwidPaymentSession"("merchantId", "createdAt");

ALTER TABLE "EcwidPaymentSession"
ADD CONSTRAINT "EcwidPaymentSession_merchantId_fkey"
FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EcwidPaymentSession"
ADD CONSTRAINT "EcwidPaymentSession_paymentTransactionId_fkey"
FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
