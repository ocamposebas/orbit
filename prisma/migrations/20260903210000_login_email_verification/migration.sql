CREATE TYPE "LoginEmailDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

ALTER TABLE "TwoFactorChallenge"
ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

CREATE TABLE "EmailLoginChallenge" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "sendCount" INTEGER NOT NULL DEFAULT 1,
  "deliveryStatus" "LoginEmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "messageId" TEXT,
  "sentAt" TIMESTAMP(3),
  "lastDeliveryErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailLoginChallenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailLoginChallenge_tokenHash_key" ON "EmailLoginChallenge"("tokenHash");
CREATE UNIQUE INDEX "EmailLoginChallenge_userId_key" ON "EmailLoginChallenge"("userId");
CREATE INDEX "EmailLoginChallenge_organizationId_expiresAt_idx" ON "EmailLoginChallenge"("organizationId", "expiresAt");
ALTER TABLE "EmailLoginChallenge" ADD CONSTRAINT "EmailLoginChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailLoginChallenge" ADD CONSTRAINT "EmailLoginChallenge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
