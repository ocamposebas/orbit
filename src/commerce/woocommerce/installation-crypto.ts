import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getServerEnv } from "@/sentinel/config";
import { HttpError } from "@/sentinel/http";

const version = "v1";

function key(encodedKey = getServerEnv().ORBIT_SECRET_ENCRYPTION_KEY) {
  if (!encodedKey || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(encodedKey)) {
    throw new HttpError(503, "WooCommerce credential encryption is not configured");
  }
  const decoded = Buffer.from(encodedKey.replaceAll("-", "+").replaceAll("_", "/"), "base64");
  if (decoded.length !== 32) throw new HttpError(503, "WooCommerce credential encryption is not configured");
  return decoded;
}

function aad(purpose: string, recordId: string) {
  return Buffer.from(`orbit-woocommerce:${purpose}:${recordId}`, "utf8");
}

export function encryptWooCommerceValue(value: string, purpose: string, recordId: string, encodedKey?: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(encodedKey), iv);
  cipher.setAAD(aad(purpose, recordId));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [version, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptWooCommerceValue(value: string, purpose: string, recordId: string, encodedKey?: string) {
  const [storedVersion, iv, tag, ciphertext, extra] = value.split(":");
  if (storedVersion !== version || !iv || !tag || !ciphertext || extra) throw new HttpError(500, "Stored WooCommerce credential is unavailable");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(encodedKey), Buffer.from(iv, "base64url"));
    decipher.setAAD(aad(purpose, recordId));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new HttpError(500, "Stored WooCommerce credential is unavailable");
  }
}

export function encryptInstallationSecret(secret: string, installationId: string, encodedKey?: string) {
  return encryptWooCommerceValue(secret, "installation-secret", installationId, encodedKey);
}

export function decryptInstallationSecret(value: string, installationId: string, encodedKey?: string) {
  return decryptWooCommerceValue(value, "installation-secret", installationId, encodedKey);
}
