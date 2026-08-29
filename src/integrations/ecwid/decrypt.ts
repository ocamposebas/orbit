import { createDecipheriv } from "node:crypto";
import { ecwidPaymentPayloadSchema, type EcwidPaymentPayload } from "./types";
import { HttpError } from "@/sentinel/http";

const MAX_ENCRYPTED_REQUEST_LENGTH = 1_500_000;

function invalidRequest(): never {
  throw new HttpError(400, "Invalid Ecwid payment request");
}

export function decryptEcwidPaymentRequest(encData: string, clientSecret: string): EcwidPaymentPayload {
  if (!encData || encData.length > MAX_ENCRYPTED_REQUEST_LENGTH || !/^[A-Za-z0-9_-]+={0,2}$/.test(encData)) return invalidRequest();
  const key = Buffer.from(clientSecret.slice(0, 16), "utf8");
  if (key.length !== 16) return invalidRequest();
  let encrypted: Buffer;
  try { encrypted = Buffer.from(encData, "base64url"); }
  catch { return invalidRequest(); }
  if (encrypted.length < 33) return invalidRequest();
  const iv = encrypted.subarray(0, 16);
  const tag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(16, encrypted.length - 16);
  try {
    const decipher = createDecipheriv("aes-128-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (plaintext.byteLength > 1_000_000) return invalidRequest();
    return ecwidPaymentPayloadSchema.parse(JSON.parse(plaintext.toString("utf8")));
  } catch {
    return invalidRequest();
  }
}
