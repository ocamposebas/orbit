import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getServerEnv } from "@/sentinel/config";
import { HttpError } from "@/sentinel/http";

function storageKey() {
  const encoded = getServerEnv().ORBIT_SECRET_ENCRYPTION_KEY;
  if (!encoded || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(encoded)) throw new HttpError(503, "Sensitive payment storage is not configured");
  const key = Buffer.from(encoded.replaceAll("-", "+").replaceAll("_", "/"), "base64");
  if (key.length !== 32) throw new HttpError(503, "Sensitive payment storage is not configured");
  return key;
}

export function encryptEcwidReturnUrl(returnUrl: string, sessionId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", storageKey(), iv);
  cipher.setAAD(Buffer.from(`orbit-ecwid-return:${sessionId}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(returnUrl, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptEcwidReturnUrl(value: string, sessionId: string) {
  const [version, iv, tag, ciphertext, extra] = value.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext || extra) throw new HttpError(500, "Stored Ecwid return URL is unavailable");
  try {
    const decipher = createDecipheriv("aes-256-gcm", storageKey(), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(`orbit-ecwid-return:${sessionId}`, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new HttpError(500, "Stored Ecwid return URL is unavailable");
  }
}
