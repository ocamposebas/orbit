import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type RelaySignatureInput = {
  merchantId: string;
  timestamp: number;
  nonce: string;
  method: string;
  path: string;
  rawBody?: string;
  secret: string;
};

export function signOrbitRelayRequest(input: RelaySignatureInput) {
  const bodyHash = createHash("sha256").update(input.rawBody ?? "").digest("hex");
  const canonical = [
    input.merchantId,
    String(input.timestamp),
    input.nonce,
    input.method.toUpperCase(),
    input.path,
    bodyHash,
  ].join("\n");

  return createHmac("sha256", input.secret).update(canonical).digest("hex");
}

export function createOrbitRelayAuthHeaders(input: {
  merchantId: string;
  method: string;
  path: string;
  rawBody?: string;
  secret: string;
  timestamp?: number;
  nonce?: string;
}) {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1_000);
  const nonce = input.nonce ?? randomBytes(24).toString("base64url");
  const signature = signOrbitRelayRequest({ ...input, timestamp, nonce });

  return {
    "X-Orbit-Merchant": input.merchantId,
    "X-Orbit-Timestamp": String(timestamp),
    "X-Orbit-Nonce": nonce,
    "X-Orbit-Signature": signature,
  };
}

export type WooCommerceSignatureInput = RelaySignatureInput & {
  installationId: string;
};

export function signWooCommerceRequest(input: WooCommerceSignatureInput) {
  const bodyHash = createHash("sha256").update(input.rawBody ?? "").digest("hex");
  const canonical = [
    input.merchantId,
    input.installationId,
    String(input.timestamp),
    input.nonce,
    input.method.toUpperCase(),
    input.path,
    bodyHash,
  ].join("\n");

  return createHmac("sha256", input.secret).update(canonical).digest("hex");
}

export function createWooCommerceAuthHeaders(input: {
  merchantId: string;
  installationId: string;
  method: string;
  path: string;
  rawBody?: string;
  secret: string;
  timestamp?: number;
  nonce?: string;
}) {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1_000);
  const nonce = input.nonce ?? randomBytes(24).toString("base64url");
  const signature = signWooCommerceRequest({ ...input, timestamp, nonce });
  return {
    "X-Orbit-Merchant": input.merchantId,
    "X-Orbit-Installation": input.installationId,
    "X-Orbit-Timestamp": String(timestamp),
    "X-Orbit-Nonce": nonce,
    "X-Orbit-Signature": signature,
  };
}

export function signaturesMatch(expectedHex: string, receivedHex: string) {
  if (!/^[a-f0-9]{64}$/i.test(expectedHex) || !/^[a-f0-9]{64}$/i.test(receivedHex)) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const received = Buffer.from(receivedHex, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
