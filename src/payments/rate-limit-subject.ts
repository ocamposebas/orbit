function unsignedPayload(token: string) {
  const encoded = typeof token === "string" ? token.split(".", 1)[0] : "";
  if (!encoded || encoded.length > 1_500) return null;
  try { return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown>; }
  catch { return null; }
}

export function checkoutTokenRateLimitSubject(token: string) {
  const payload = unsignedPayload(token);
  const merchantId = typeof payload?.merchantId === "string" ? payload.merchantId : "invalid";
  const wooOrderId = typeof payload?.wooOrderId === "number" ? payload.wooOrderId : "invalid";
  return `${merchantId}:${wooOrderId}`;
}

export function configTokenRateLimitSubject(token: string) {
  const payload = unsignedPayload(token);
  return typeof payload?.merchantId === "string" ? payload.merchantId : "invalid";
}
