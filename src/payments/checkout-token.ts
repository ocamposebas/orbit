import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { decryptRelaySecret } from "@/commerce/woocommerce/crypto";
import { getDatabase } from "@/sentinel/db";
import { HttpError } from "@/sentinel/http";

const checkoutTokenPayloadSchema = z.object({
  v: z.literal(1),
  merchantId: z.string().trim().min(1).max(128),
  wooOrderId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  exp: z.number().int().positive(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
}).strict();

const checkoutConfigTokenPayloadSchema = z.object({
  v: z.literal(1),
  purpose: z.literal("checkout_config"),
  merchantId: z.string().trim().min(1).max(128),
  exp: z.number().int().positive(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
}).strict();

function checkoutTokenSignature(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest("hex");
}

export function createCheckoutToken(input: z.infer<typeof checkoutTokenPayloadSchema>, secret: string) {
  const payload = checkoutTokenPayloadSchema.parse(input);
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${checkoutTokenSignature(encodedPayload, secret)}`;
}

function invalidToken(): never {
  throw new HttpError(401, "Invalid or expired checkout token");
}

export async function verifyCheckoutToken(token: string) {
  if (typeof token !== "string" || token.length > 2_048) return invalidToken();
  const match = token.match(/^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/);
  if (!match) return invalidToken();

  let payload: z.infer<typeof checkoutTokenPayloadSchema>;
  try {
    const decoded = Buffer.from(match[1], "base64url").toString("utf8");
    payload = checkoutTokenPayloadSchema.parse(JSON.parse(decoded));
  } catch {
    return invalidToken();
  }

  const now = Math.floor(Date.now() / 1_000);
  if (payload.exp <= now || payload.exp > now + 900) return invalidToken();
  const integration = await getDatabase().wooCommerceRelayIntegration.findUnique({ where: { merchantId: payload.merchantId }, select: { encryptedSigningSecret: true, connectionEnabled: true } });
  if (!integration?.connectionEnabled) return invalidToken();

  let secret: string;
  try { secret = decryptRelaySecret(integration.encryptedSigningSecret, payload.merchantId); }
  catch { return invalidToken(); }
  const expected = Buffer.from(checkoutTokenSignature(match[1], secret), "hex");
  const received = Buffer.from(match[2], "hex");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return invalidToken();
  return payload;
}

export async function verifyCheckoutConfigToken(token: string) {
  if (typeof token !== "string" || token.length > 2_048) return invalidToken();
  const match = token.match(/^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/);
  if (!match) return invalidToken();

  let payload: z.infer<typeof checkoutConfigTokenPayloadSchema>;
  try {
    const decoded = Buffer.from(match[1], "base64url").toString("utf8");
    payload = checkoutConfigTokenPayloadSchema.parse(JSON.parse(decoded));
  } catch {
    return invalidToken();
  }

  const now = Math.floor(Date.now() / 1_000);
  if (payload.exp <= now || payload.exp > now + 900) return invalidToken();
  const integration = await getDatabase().wooCommerceRelayIntegration.findUnique({ where: { merchantId: payload.merchantId }, select: { encryptedSigningSecret: true, connectionEnabled: true } });
  if (!integration?.connectionEnabled) return invalidToken();

  let secret: string;
  try { secret = decryptRelaySecret(integration.encryptedSigningSecret, payload.merchantId); }
  catch { return invalidToken(); }
  const expected = Buffer.from(checkoutTokenSignature(match[1], secret), "hex");
  const received = Buffer.from(match[2], "hex");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return invalidToken();
  return payload;
}
