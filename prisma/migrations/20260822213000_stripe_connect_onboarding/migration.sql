-- Add Stripe Connect onboarding and verification monitoring without altering existing data.
CREATE TYPE "StripeEnvironment" AS ENUM ('TEST', 'LIVE');
CREATE TYPE "StripeAccountApiVersion" AS ENUM ('V1', 'V2');
CREATE TYPE "StripeConnectDisplayStatus" AS ENUM ('NOT_CONNECTED', 'ONBOARDING', 'ACTION_REQUIRED', 'IN_REVIEW', 'RESTRICTED', 'ENABLED', 'UNKNOWN');
CREATE TYPE "StripeConnectEventStatus" AS ENUM ('PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED');

CREATE TABLE "StripeConnectIntegration" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "stripeAccountId" TEXT NOT NULL,
    "stripeEnvironment" "StripeEnvironment" NOT NULL,
    "accountApiVersion" "StripeAccountApiVersion" NOT NULL DEFAULT 'V2',
    "displayStatus" "StripeConnectDisplayStatus" NOT NULL DEFAULT 'ONBOARDING',
    "cardPaymentsStatus" TEXT,
    "payoutsStatus" TEXT,
    "requirementsCurrentlyDue" JSONB NOT NULL DEFAULT '[]',
    "requirementsEventuallyDue" JSONB NOT NULL DEFAULT '[]',
    "requirementsPastDue" JSONB NOT NULL DEFAULT '[]',
    "requirementsPendingVerification" JSONB NOT NULL DEFAULT '[]',
    "futureRequirements" JSONB NOT NULL DEFAULT '[]',
    "statusDetails" JSONB NOT NULL DEFAULT '[]',
    "disabledReason" TEXT,
    "onboardingStartedAt" TIMESTAMP(3),
    "onboardingCompletedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "rawStripeState" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StripeConnectIntegration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StripeConnectEvent" (
    "id" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "stripeAccountId" TEXT,
    "integrationId" TEXT,
    "type" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "status" "StripeConnectEventStatus" NOT NULL DEFAULT 'PROCESSING',
    "processedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StripeConnectEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StripeConnectIntegration_merchantId_key" ON "StripeConnectIntegration"("merchantId");
CREATE UNIQUE INDEX "StripeConnectIntegration_stripeAccountId_key" ON "StripeConnectIntegration"("stripeAccountId");
CREATE INDEX "StripeConnectIntegration_stripeEnvironment_displayStatus_idx" ON "StripeConnectIntegration"("stripeEnvironment", "displayStatus");
CREATE UNIQUE INDEX "StripeConnectEvent_stripeEventId_key" ON "StripeConnectEvent"("stripeEventId");
CREATE INDEX "StripeConnectEvent_stripeAccountId_createdAt_idx" ON "StripeConnectEvent"("stripeAccountId", "createdAt");
CREATE INDEX "StripeConnectEvent_status_createdAt_idx" ON "StripeConnectEvent"("status", "createdAt");

ALTER TABLE "StripeConnectIntegration" ADD CONSTRAINT "StripeConnectIntegration_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StripeConnectEvent" ADD CONSTRAINT "StripeConnectEvent_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "StripeConnectIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
