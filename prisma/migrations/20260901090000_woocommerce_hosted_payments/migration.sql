CREATE TYPE "WooCommerceInstallationEnvironment" AS ENUM ('LIVE', 'TEST');
CREATE TYPE "PaymentSessionPlatform" AS ENUM ('WOOCOMMERCE', 'ECWID');
CREATE TYPE "PaymentSessionStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED');
CREATE TYPE "PaymentEventDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

ALTER TABLE "Merchant" ADD COLUMN "publicId" TEXT;
ALTER TABLE "PaymentTransaction" ADD COLUMN "publicPaymentId" TEXT;

CREATE TABLE "WooCommerceInstallation" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "origin" TEXT NOT NULL,
  "environment" "WooCommerceInstallationEnvironment" NOT NULL,
  "encryptedSigningSecret" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "hostedPaymentsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "pluginVersion" TEXT,
  "wooCommerceVersion" TEXT,
  "wordPressVersion" TEXT,
  "lastSeenAt" TIMESTAMP(3),
  "lastPaymentAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WooCommerceInstallation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WooCommerceConnectionCode" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "environment" "WooCommerceInstallationEnvironment" NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "installationId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WooCommerceConnectionCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WooCommerceRequestNonce" (
  "id" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "nonceHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WooCommerceRequestNonce_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentSession" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "paymentTransactionId" TEXT NOT NULL,
  "platform" "PaymentSessionPlatform" NOT NULL DEFAULT 'WOOCOMMERCE',
  "environment" "WooCommerceInstallationEnvironment" NOT NULL,
  "platformOrderId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "status" "PaymentSessionStatus" NOT NULL DEFAULT 'PENDING',
  "encryptedSuccessReturnUrl" TEXT NOT NULL,
  "encryptedCancelReturnUrl" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentSession_amountMinor_positive_check" CHECK ("amountMinor" > 0),
  CONSTRAINT "PaymentSession_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE TABLE "PaymentEventDelivery" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "paymentSessionId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "PaymentEventDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "lastHttpStatus" INTEGER,
  "lastErrorCode" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentEventDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WooCommerceInstallation_origin_environment_key" ON "WooCommerceInstallation"("origin", "environment");
CREATE UNIQUE INDEX "Merchant_publicId_key" ON "Merchant"("publicId");
CREATE UNIQUE INDEX "PaymentTransaction_publicPaymentId_key" ON "PaymentTransaction"("publicPaymentId");
CREATE INDEX "WooCommerceInstallation_merchantId_enabled_revokedAt_idx" ON "WooCommerceInstallation"("merchantId", "enabled", "revokedAt");
CREATE INDEX "WooCommerceInstallation_lastSeenAt_idx" ON "WooCommerceInstallation"("lastSeenAt");
CREATE UNIQUE INDEX "WooCommerceConnectionCode_codeHash_key" ON "WooCommerceConnectionCode"("codeHash");
CREATE INDEX "WooCommerceConnectionCode_merchantId_expiresAt_idx" ON "WooCommerceConnectionCode"("merchantId", "expiresAt");
CREATE INDEX "WooCommerceConnectionCode_expiresAt_consumedAt_idx" ON "WooCommerceConnectionCode"("expiresAt", "consumedAt");
CREATE UNIQUE INDEX "WooCommerceRequestNonce_installationId_nonceHash_key" ON "WooCommerceRequestNonce"("installationId", "nonceHash");
CREATE INDEX "WooCommerceRequestNonce_expiresAt_idx" ON "WooCommerceRequestNonce"("expiresAt");
CREATE UNIQUE INDEX "PaymentSession_paymentTransactionId_key" ON "PaymentSession"("paymentTransactionId");
CREATE UNIQUE INDEX "PaymentSession_idempotencyKey_key" ON "PaymentSession"("idempotencyKey");
CREATE UNIQUE INDEX "PaymentSession_platform_installationId_platformOrderId_environment_key" ON "PaymentSession"("platform", "installationId", "platformOrderId", "environment");
CREATE INDEX "PaymentSession_merchantId_status_createdAt_idx" ON "PaymentSession"("merchantId", "status", "createdAt");
CREATE INDEX "PaymentSession_installationId_status_expiresAt_idx" ON "PaymentSession"("installationId", "status", "expiresAt");
CREATE UNIQUE INDEX "PaymentEventDelivery_paymentSessionId_type_key" ON "PaymentEventDelivery"("paymentSessionId", "type");
CREATE INDEX "PaymentEventDelivery_status_nextAttemptAt_idx" ON "PaymentEventDelivery"("status", "nextAttemptAt");
CREATE INDEX "PaymentEventDelivery_installationId_createdAt_idx" ON "PaymentEventDelivery"("installationId", "createdAt");

ALTER TABLE "WooCommerceInstallation" ADD CONSTRAINT "WooCommerceInstallation_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WooCommerceConnectionCode" ADD CONSTRAINT "WooCommerceConnectionCode_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WooCommerceConnectionCode" ADD CONSTRAINT "WooCommerceConnectionCode_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "WooCommerceInstallation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WooCommerceRequestNonce" ADD CONSTRAINT "WooCommerceRequestNonce_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "WooCommerceInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentSession" ADD CONSTRAINT "PaymentSession_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentSession" ADD CONSTRAINT "PaymentSession_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "WooCommerceInstallation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentSession" ADD CONSTRAINT "PaymentSession_paymentTransactionId_fkey" FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentEventDelivery" ADD CONSTRAINT "PaymentEventDelivery_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentEventDelivery" ADD CONSTRAINT "PaymentEventDelivery_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "WooCommerceInstallation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentEventDelivery" ADD CONSTRAINT "PaymentEventDelivery_paymentSessionId_fkey" FOREIGN KEY ("paymentSessionId") REFERENCES "PaymentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
