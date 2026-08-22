CREATE TABLE "MerchantAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MerchantAccess_userId_merchantId_key" ON "MerchantAccess"("userId", "merchantId");
CREATE INDEX "MerchantAccess_merchantId_idx" ON "MerchantAccess"("merchantId");

ALTER TABLE "MerchantAccess" ADD CONSTRAINT "MerchantAccess_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MerchantAccess" ADD CONSTRAINT "MerchantAccess_merchantId_fkey"
FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
