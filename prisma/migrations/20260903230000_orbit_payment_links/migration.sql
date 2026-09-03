-- Payment Links are additive and isolated from WooCommerce/Ecwid transactions.
ALTER TABLE "MerchantAccess"
ADD COLUMN "canCreatePaymentLinks" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "OrbitPaymentLinkStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "OrbitPaymentLink" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "merchantId" TEXT,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "platformFeeBps" INTEGER,
    "stripeEnvironment" "StripeEnvironment" NOT NULL,
    "status" "OrbitPaymentLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrbitPaymentLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrbitPaymentLinkPayment" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "paymentLinkId" TEXT NOT NULL,
    "checkoutKey" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "stripeAccountId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "platformFeeMinor" INTEGER NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "failureCode" TEXT,
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'CREATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrbitPaymentLinkPayment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "StripePaymentEvent"
ADD COLUMN "orbitPaymentLinkPaymentId" TEXT;

CREATE UNIQUE INDEX "OrbitPaymentLink_publicId_key" ON "OrbitPaymentLink"("publicId");
CREATE INDEX "OrbitPaymentLink_organizationId_status_createdAt_idx" ON "OrbitPaymentLink"("organizationId", "status", "createdAt");
CREATE INDEX "OrbitPaymentLink_merchantId_status_createdAt_idx" ON "OrbitPaymentLink"("merchantId", "status", "createdAt");
CREATE UNIQUE INDEX "OrbitPaymentLinkPayment_publicId_key" ON "OrbitPaymentLinkPayment"("publicId");
CREATE UNIQUE INDEX "OrbitPaymentLinkPayment_stripePaymentIntentId_key" ON "OrbitPaymentLinkPayment"("stripePaymentIntentId");
CREATE UNIQUE INDEX "OrbitPaymentLinkPayment_paymentLinkId_checkoutKey_key" ON "OrbitPaymentLinkPayment"("paymentLinkId", "checkoutKey");
CREATE INDEX "OrbitPaymentLinkPayment_paymentLinkId_status_createdAt_idx" ON "OrbitPaymentLinkPayment"("paymentLinkId", "status", "createdAt");
CREATE INDEX "OrbitPaymentLinkPayment_stripeAccountId_status_idx" ON "OrbitPaymentLinkPayment"("stripeAccountId", "status");
CREATE INDEX "StripePaymentEvent_orbitPaymentLinkPaymentId_createdAt_idx" ON "StripePaymentEvent"("orbitPaymentLinkPaymentId", "createdAt");

ALTER TABLE "OrbitPaymentLink" ADD CONSTRAINT "OrbitPaymentLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrbitPaymentLink" ADD CONSTRAINT "OrbitPaymentLink_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrbitPaymentLink" ADD CONSTRAINT "OrbitPaymentLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrbitPaymentLinkPayment" ADD CONSTRAINT "OrbitPaymentLinkPayment_paymentLinkId_fkey" FOREIGN KEY ("paymentLinkId") REFERENCES "OrbitPaymentLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StripePaymentEvent" ADD CONSTRAINT "StripePaymentEvent_orbitPaymentLinkPaymentId_fkey" FOREIGN KEY ("orbitPaymentLinkPaymentId") REFERENCES "OrbitPaymentLinkPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
