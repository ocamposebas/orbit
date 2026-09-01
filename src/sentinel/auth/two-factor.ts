import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/sentinel/config";
import { HttpError } from "@/sentinel/http";
import { getDatabase } from "@/sentinel/db";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const version = "v1";

function encryptionKey() {
  const encoded = getServerEnv().ORBIT_SECRET_ENCRYPTION_KEY;
  if (!encoded) throw new HttpError(503, "Two-factor authentication encryption is not configured");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new HttpError(503, "Two-factor authentication encryption is not configured");
  return key;
}

function base32Encode(value: Buffer) {
  let bits = "";
  for (const byte of value) bits += byte.toString(2).padStart(8, "0");
  let result = "";
  for (let index = 0; index < bits.length; index += 5) result += alphabet[Number.parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
  return result;
}

function base32Decode(value: string) {
  const normalized = value.toUpperCase().replace(/=|\s|-/g, "");
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new HttpError(400, "Invalid authenticator secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

export function createTwoFactorSecret() { return base32Encode(randomBytes(20)); }

export function encryptTwoFactorSecret(secret: string, userId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`orbit:two-factor:${userId}`));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [version, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptTwoFactorSecret(value: string, userId: string) {
  const [storedVersion, iv, tag, ciphertext, extra] = value.split(":");
  if (storedVersion !== version || !iv || !tag || !ciphertext || extra) throw new HttpError(500, "Stored two-factor secret cannot be decrypted");
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(`orbit:two-factor:${userId}`));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, "Stored two-factor secret cannot be decrypted");
  }
}

function totp(secret: string, counter: number) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, "0");
}

export function verifyTwoFactorCode(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(now / 30_000);
  const input = Buffer.from(code);
  return [-1, 0, 1].some((offset) => timingSafeEqual(input, Buffer.from(totp(secret, counter + offset))));
}

export function twoFactorProvisioningUri(secret: string, email: string) {
  const label = encodeURIComponent(`ORBIT:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=ORBIT&algorithm=SHA1&digits=6&period=30`;
}

export const twoFactorTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function requireTwoFactorCode(userId: string, code: string) {
  const user = await getDatabase().user.findUnique({ where: { id: userId }, select: { twoFactorEnabledAt: true, twoFactorSecretEncrypted: true } });
  if (!user?.twoFactorEnabledAt || !user.twoFactorSecretEncrypted) throw new HttpError(403, "Enable two-factor authentication in Settings before moving money.");
  if (!verifyTwoFactorCode(decryptTwoFactorSecret(user.twoFactorSecretEncrypted, userId), code)) throw new HttpError(401, "Authenticator code is incorrect");
}
