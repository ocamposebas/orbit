import { createHash, randomBytes } from "node:crypto";
import type { WooCommerceInstallationEnvironment } from "@/generated/prisma/client";
import { getDatabase } from "@/sentinel/db";
import { HttpError } from "@/sentinel/http";
import { validateWooCommerceBaseUrl } from "./configuration";
import { encryptInstallationSecret } from "./installation-crypto";

const CONNECTION_CODE_TTL_MS = 10 * 60_000;

function publicId(prefix: string, bytes = 18) {
  return `${prefix}${randomBytes(bytes).toString("base64url")}`;
}

function connectionCode(environment: WooCommerceInstallationEnvironment) {
  return `orb_${environment === "LIVE" ? "live" : "test"}_${randomBytes(24).toString("base64url")}`;
}

function normalizedCode(value: string) {
  return value.trim().toLowerCase();
}

function codeHash(value: string) {
  return createHash("sha256").update(normalizedCode(value), "utf8").digest("hex");
}

function environmentName(environment: WooCommerceInstallationEnvironment) {
  return environment === "LIVE" ? "live" : "test";
}

async function ensureMerchantPublicId(merchantId: string) {
  const db = getDatabase();
  const merchant = await db.merchant.findUnique({ where: { id: merchantId }, select: { publicId: true } });
  if (!merchant) throw new HttpError(404, "Merchant not found");
  if (merchant.publicId) return merchant.publicId;
  const publicMerchantId = publicId("mrc_");
  const saved = await db.merchant.update({ where: { id: merchantId }, data: { publicId: publicMerchantId }, select: { publicId: true } });
  return saved.publicId!;
}

export function safeWooCommerceInstallation(installation: {
  id: string;
  merchantId: string;
  origin: string;
  environment: WooCommerceInstallationEnvironment;
  enabled: boolean;
  hostedPaymentsEnabled: boolean;
  pluginVersion: string | null;
  wooCommerceVersion: string | null;
  wordPressVersion: string | null;
  lastSeenAt: Date | null;
  lastPaymentAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    installationId: installation.id,
    merchantId: installation.merchantId,
    origin: installation.origin,
    domain: new URL(installation.origin).hostname,
    environment: environmentName(installation.environment),
    enabled: installation.enabled,
    hostedPaymentsEnabled: installation.hostedPaymentsEnabled,
    status: installation.revokedAt ? "revoked" : installation.enabled ? "connected" : "disabled",
    pluginVersion: installation.pluginVersion,
    wooCommerceVersion: installation.wooCommerceVersion,
    wordPressVersion: installation.wordPressVersion,
    lastSeenAt: installation.lastSeenAt,
    lastPaymentAt: installation.lastPaymentAt,
    revokedAt: installation.revokedAt,
    createdAt: installation.createdAt,
    updatedAt: installation.updatedAt,
  };
}

export async function createWooCommerceConnectionCode(input: {
  merchantId: string;
  createdById: string;
  environment: WooCommerceInstallationEnvironment;
}) {
  await ensureMerchantPublicId(input.merchantId);
  const code = connectionCode(input.environment);
  const expiresAt = new Date(Date.now() + CONNECTION_CODE_TTL_MS);
  await getDatabase().wooCommerceConnectionCode.create({ data: {
    id: publicId("orb_cc_"),
    merchantId: input.merchantId,
    codeHash: codeHash(code),
    environment: input.environment,
    expiresAt,
    createdById: input.createdById,
  } });
  return { code, expiresAt, environment: environmentName(input.environment) };
}

export async function exchangeWooCommerceConnectionCode(input: {
  code: string;
  origin: string;
  environment?: WooCommerceInstallationEnvironment;
  pluginVersion?: string;
  wooCommerceVersion?: string;
  wordPressVersion?: string;
}) {
  const db = getDatabase();
  const stored = await db.wooCommerceConnectionCode.findUnique({ where: { codeHash: codeHash(input.code) } });
  const now = new Date();
  if (!stored || stored.consumedAt || stored.expiresAt <= now || (input.environment && input.environment !== stored.environment)) {
    throw new HttpError(401, "Invalid or expired WooCommerce connection code");
  }
  const origin = await validateWooCommerceBaseUrl(input.origin, stored.environment === "LIVE" ? "PRODUCTION" : "STAGING");
  const installationSecret = randomBytes(32).toString("base64url");
  const newInstallationId = publicId("ins_");
  const publicMerchantId = await ensureMerchantPublicId(stored.merchantId);

  const installation = await db.$transaction(async (tx) => {
    const claimed = await tx.wooCommerceConnectionCode.updateMany({
      where: { id: stored.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1) throw new HttpError(401, "Invalid or expired WooCommerce connection code");

    const existing = await tx.wooCommerceInstallation.findUnique({
      where: { origin_environment: { origin, environment: stored.environment } },
    });
    if (existing && existing.merchantId !== stored.merchantId) {
      throw new HttpError(409, "This WooCommerce site is already connected to another ORBIT merchant");
    }
    const installationId = existing?.id ?? newInstallationId;
    const encryptedSigningSecret = encryptInstallationSecret(installationSecret, installationId);
    const saved = existing
      ? await tx.wooCommerceInstallation.update({ where: { id: existing.id }, data: {
          encryptedSigningSecret,
          enabled: true,
          hostedPaymentsEnabled: true,
          revokedAt: null,
          pluginVersion: input.pluginVersion,
          wooCommerceVersion: input.wooCommerceVersion,
          wordPressVersion: input.wordPressVersion,
          lastSeenAt: now,
        } })
      : await tx.wooCommerceInstallation.create({ data: {
          id: installationId,
          merchantId: stored.merchantId,
          origin,
          environment: stored.environment,
          encryptedSigningSecret,
          pluginVersion: input.pluginVersion,
          wooCommerceVersion: input.wooCommerceVersion,
          wordPressVersion: input.wordPressVersion,
          lastSeenAt: now,
        } });
    if (existing) await tx.wooCommerceRequestNonce.deleteMany({ where: { installationId: existing.id } });
    await tx.wooCommerceConnectionCode.update({ where: { id: stored.id }, data: { installationId: saved.id } });
    return saved;
  });

  return {
    merchant_id: publicMerchantId,
    installation_id: installation.id,
    installation_secret: installationSecret,
    environment: environmentName(installation.environment),
  };
}

export async function revokeWooCommerceInstallation(merchantId: string, installationId: string) {
  const updated = await getDatabase().wooCommerceInstallation.updateMany({
    where: { id: installationId, merchantId },
    data: { enabled: false, hostedPaymentsEnabled: false, revokedAt: new Date() },
  });
  if (updated.count !== 1) throw new HttpError(404, "WooCommerce installation not found");
}
