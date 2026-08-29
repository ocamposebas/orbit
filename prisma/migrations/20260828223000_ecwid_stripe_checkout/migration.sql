CREATE TYPE "EcwidCheckoutMode" AS ENUM ('STRIPE_CHECKOUT', 'ORBIT_HOSTED');

ALTER TABLE "EcwidPaymentSession"
ADD COLUMN "checkoutMode" "EcwidCheckoutMode" NOT NULL DEFAULT 'ORBIT_HOSTED',
ADD COLUMN "stripeCheckoutSessionId" TEXT,
ADD COLUMN "stripeCheckoutExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "EcwidPaymentSession_stripeCheckoutSessionId_key"
ON "EcwidPaymentSession"("stripeCheckoutSessionId");
