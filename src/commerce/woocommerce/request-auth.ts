import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { getDatabase } from "@/sentinel/db";
import { HttpError } from "@/sentinel/http";
import { signWooCommerceRequest, signaturesMatch } from "./auth";
import { decryptInstallationSecret } from "./installation-crypto";

const TIMESTAMP_TOLERANCE_SECONDS = 300;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function requiredHeader(request: NextRequest, name: string, maximumLength: number) {
  const value = request.headers.get(name)?.trim();
  if (!value || value.length > maximumLength) throw new HttpError(401, "Invalid WooCommerce authentication");
  return value;
}

export async function authenticateWooCommerceRequest(request: NextRequest, rawBody: string) {
  const merchantId = requiredHeader(request, "x-orbit-merchant", 160);
  const installationId = requiredHeader(request, "x-orbit-installation", 160);
  const timestampValue = requiredHeader(request, "x-orbit-timestamp", 20);
  const nonce = requiredHeader(request, "x-orbit-nonce", 128);
  const signature = requiredHeader(request, "x-orbit-signature", 128);
  if (!/^\d{10}$/.test(timestampValue) || !NONCE_PATTERN.test(nonce)) throw new HttpError(401, "Invalid WooCommerce authentication");
  const timestamp = Number(timestampValue);
  const nowSeconds = Math.floor(Date.now() / 1_000);
  if (Math.abs(nowSeconds - timestamp) > TIMESTAMP_TOLERANCE_SECONDS) throw new HttpError(401, "Expired WooCommerce authentication");

  const db = getDatabase();
  const installation = await db.wooCommerceInstallation.findFirst({ where: {
    id: installationId,
    merchant: { publicId: merchantId },
    enabled: true,
    hostedPaymentsEnabled: true,
    revokedAt: null,
  }, include: { merchant: { select: { publicId: true } } } });
  if (!installation?.merchant.publicId) throw new HttpError(401, "Invalid WooCommerce authentication");
  const secret = decryptInstallationSecret(installation.encryptedSigningSecret, installation.id);
  const expected = signWooCommerceRequest({
    merchantId,
    installationId,
    timestamp,
    nonce,
    method: request.method,
    path: request.nextUrl.pathname,
    rawBody,
    secret,
  });
  if (!signaturesMatch(expected, signature)) throw new HttpError(401, "Invalid WooCommerce authentication");

  const nonceHash = createHash("sha256").update(nonce, "utf8").digest("hex");
  try {
    await db.wooCommerceRequestNonce.create({ data: {
      installationId: installation.id,
      nonceHash,
      expiresAt: new Date((timestamp + TIMESTAMP_TOLERANCE_SECONDS) * 1_000),
    } });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      throw new HttpError(409, "WooCommerce request replay rejected");
    }
    throw error;
  }
  await db.wooCommerceInstallation.update({ where: { id: installation.id }, data: { lastSeenAt: new Date() } });
  void db.wooCommerceRequestNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);
  return { ...installation, publicMerchantId: installation.merchant.publicId };
}
