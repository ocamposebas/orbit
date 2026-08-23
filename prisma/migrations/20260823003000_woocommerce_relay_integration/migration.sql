CREATE TYPE "WooCommerceRelayEnvironment" AS ENUM ('PRODUCTION', 'STAGING');

CREATE TYPE "WooCommerceRelayStatus" AS ENUM (
  'NOT_CONFIGURED',
  'CONFIGURED',
  'CONNECTED',
  'UNREACHABLE',
  'WOO_UNAVAILABLE',
  'RELAY_UNAVAILABLE',
  'AUTH_NOT_TESTED',
  'ERROR'
);

CREATE TABLE "WooCommerceRelayIntegration" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "baseUrl" TEXT NOT NULL,
  "environment" "WooCommerceRelayEnvironment" NOT NULL,
  "connectionEnabled" BOOLEAN NOT NULL DEFAULT true,
  "encryptedSigningSecret" TEXT NOT NULL,
  "connectionStatus" "WooCommerceRelayStatus" NOT NULL DEFAULT 'CONFIGURED',
  "relayVersion" TEXT,
  "woocommerceAvailable" BOOLEAN,
  "lastHealthCheckAt" TIMESTAMP(3),
  "lastSuccessfulRequestAt" TIMESTAMP(3),
  "lastLatencyMs" INTEGER,
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WooCommerceRelayIntegration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WooCommerceRelayIntegration_merchantId_key"
ON "WooCommerceRelayIntegration"("merchantId");

CREATE INDEX "WooCommerceRelayIntegration_environment_connectionStatus_idx"
ON "WooCommerceRelayIntegration"("environment", "connectionStatus");

ALTER TABLE "WooCommerceRelayIntegration"
ADD CONSTRAINT "WooCommerceRelayIntegration_merchantId_fkey"
FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
