ALTER TABLE "Merchant"
ADD COLUMN "stripeOnboardingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "stripeOnboardingEnabledAt" TIMESTAMP(3);

-- Preserve access for merchants whose Stripe verification was already started.
-- New and not-yet-started merchants remain locked until an ORBIT administrator
-- explicitly enables the application from the merchant panel.
UPDATE "Merchant" AS merchant
SET
  "stripeOnboardingEnabled" = true,
  "stripeOnboardingEnabledAt" = COALESCE(integration."onboardingStartedAt", CURRENT_TIMESTAMP)
FROM "StripeConnectIntegration" AS integration
WHERE integration."merchantId" = merchant."id"
  AND integration."onboardingStartedAt" IS NOT NULL;
