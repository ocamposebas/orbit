-- Preserve every signed agreement uploaded through customer or workspace custody.
CREATE TABLE "SignedAgreementRevision" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "sizeBytes" INTEGER NOT NULL,
    "contract" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignedAgreementRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SignedAgreementRevision_agreementId_revision_key"
ON "SignedAgreementRevision"("agreementId", "revision");

CREATE INDEX "SignedAgreementRevision_agreementId_uploadedAt_idx"
ON "SignedAgreementRevision"("agreementId", "uploadedAt");

ALTER TABLE "SignedAgreementRevision"
ADD CONSTRAINT "SignedAgreementRevision_agreementId_fkey"
FOREIGN KEY ("agreementId") REFERENCES "MerchantAgreement"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing locked agreements become revision 1 without altering their current copy.
INSERT INTO "SignedAgreementRevision" (
    "id", "agreementId", "revision", "originalName", "mimeType",
    "sizeBytes", "contract", "sha256", "source", "uploadedAt"
)
SELECT
    'legacy_' || md5("id"),
    "id",
    1,
    COALESCE("signedOriginalName", 'signed-agreement.pdf'),
    COALESCE("signedMimeType", 'application/pdf'),
    COALESCE("signedSizeBytes", octet_length("signedContract")),
    "signedContract",
    COALESCE("signedSha256", md5("signedContract")),
    'LEGACY',
    COALESCE("signedUploadedAt", "lockedAt", "updatedAt")
FROM "MerchantAgreement"
WHERE "signedContract" IS NOT NULL;
