CREATE TYPE "AgreementStatus" AS ENUM ('INVITED', 'DATA_COMPLETED', 'CONTRACT_ISSUED', 'SIGNED_LOCKED');

CREATE TABLE "MerchantAgreement" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "status" "AgreementStatus" NOT NULL DEFAULT 'INVITED',
    "invitationTokenHash" TEXT NOT NULL,
    "invitationExpiresAt" TIMESTAMP(3) NOT NULL,
    "termsVersion" TEXT NOT NULL DEFAULT 'orbit-msa-es-1.0',
    "legalName" TEXT,
    "tradeName" TEXT,
    "entityType" TEXT,
    "taxId" TEXT,
    "registrationNumber" TEXT,
    "businessAddress" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "countryCode" TEXT,
    "coveredDomains" TEXT,
    "primaryContactName" TEXT,
    "primaryContactRole" TEXT,
    "primaryContactEmail" TEXT,
    "primaryContactPhone" TEXT,
    "billingDescriptor" TEXT,
    "estimatedMonthlyVolume" TEXT,
    "averageTransactionAmount" TEXT,
    "highestTransactionAmount" TEXT,
    "productsAndServices" TEXT,
    "informationCertifiedAt" TIMESTAMP(3),
    "contractIssuedAt" TIMESTAMP(3),
    "contractPdf" BYTEA,
    "contractSha256" TEXT,
    "signedOriginalName" TEXT,
    "signedMimeType" TEXT,
    "signedSizeBytes" INTEGER,
    "signedContract" BYTEA,
    "signedSha256" TEXT,
    "signedUploadedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantAgreement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MerchantAgreement_merchantId_key" ON "MerchantAgreement"("merchantId");
CREATE UNIQUE INDEX "MerchantAgreement_invitationTokenHash_key" ON "MerchantAgreement"("invitationTokenHash");
CREATE INDEX "MerchantAgreement_status_updatedAt_idx" ON "MerchantAgreement"("status", "updatedAt");
CREATE INDEX "MerchantAgreement_invitationExpiresAt_idx" ON "MerchantAgreement"("invitationExpiresAt");

ALTER TABLE "MerchantAgreement" ADD CONSTRAINT "MerchantAgreement_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
