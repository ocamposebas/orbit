import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getServerEnv } from "@/sentinel/config";
import { RelayError } from "./types";

const encryptionVersion = "v1";

function encryptionKey(encodedKey = getServerEnv().ORBIT_SECRET_ENCRYPTION_KEY) {
  if (!encodedKey || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(encodedKey)) {
    throw new RelayError(503, "UNKNOWN", "Relay secret encryption is not configured");
  }
  const key = Buffer.from(encodedKey.replaceAll("-", "+").replaceAll("_", "/"), "base64");
  if (key.length !== 32) throw new RelayError(503, "UNKNOWN", "Relay secret encryption is not configured");
  return key;
}

export function encryptRelaySecret(secret: string, merchantId: string, encodedKey?: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(encodedKey), iv);
  cipher.setAAD(Buffer.from(`orbit-relay:${merchantId}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [encryptionVersion, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptRelaySecret(value: string, merchantId: string, encodedKey?: string) {
  const [version, ivValue, tagValue, ciphertextValue, extra] = value.split(":");
  if (version !== encryptionVersion || !ivValue || !tagValue || !ciphertextValue || extra) throw new RelayError(500, "UNKNOWN", "Stored Relay secret cannot be decrypted");
  const key = encryptionKey(encodedKey);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
    decipher.setAAD(Buffer.from(`orbit-relay:${merchantId}`, "utf8"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new RelayError(500, "UNKNOWN", "Stored Relay secret cannot be decrypted");
  }
}
