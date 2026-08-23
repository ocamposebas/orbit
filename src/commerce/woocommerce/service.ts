import { z } from "zod";
import { createOrbitRelayAuthHeaders } from "./auth";
import { decryptRelaySecret } from "./crypto";
import { getDatabase } from "@/sentinel/db";
import { safeFetchText } from "@/sentinel/security/ssrf";
import { RelayError, type RelayConnectionStatus, type RelayErrorCode } from "./types";

const healthSchema = z.object({
  ok: z.boolean(),
  service: z.string(),
  woocommerce: z.boolean(),
  version: z.string().trim().min(1).max(64),
});

const orderSchema = z.object({
  order_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  status: z.string().trim().min(1).max(64),
  currency: z.string().regex(/^[A-Z]{3}$/),
  total_minor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  payment_required: z.boolean(),
  paid: z.boolean(),
});

const wordpressErrorSchema = z.object({ code: z.string().trim().min(1).max(128) });

type RelayRecord = {
  id: string;
  merchantId: string;
  baseUrl: string;
  environment: string;
  connectionEnabled: boolean;
  connectionStatus: string;
  relayVersion: string | null;
  woocommerceAvailable: boolean | null;
  lastHealthCheckAt: Date | null;
  lastSuccessfulRequestAt: Date | null;
  lastLatencyMs: number | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function safeRelayIntegration(value: RelayRecord) {
  return {
    id: value.id,
    merchantId: value.merchantId,
    baseUrl: value.baseUrl,
    environment: value.environment,
    connectionEnabled: value.connectionEnabled,
    connectionStatus: value.connectionStatus,
    relayVersion: value.relayVersion,
    woocommerceAvailable: value.woocommerceAvailable,
    lastHealthCheckAt: value.lastHealthCheckAt,
    lastSuccessfulRequestAt: value.lastSuccessfulRequestAt,
    lastLatencyMs: value.lastLatencyMs,
    lastErrorCode: value.lastErrorCode,
    signingConfigured: true,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function normalizedFailure(error: unknown): { code: RelayErrorCode; status: RelayConnectionStatus; message: string } {
  const value = error as { name?: string; code?: string; cause?: { code?: string }; message?: string };
  const code = value.code ?? value.cause?.code ?? "";
  if (value.name === "AbortError" || /timeout/i.test(value.message ?? "") || code.includes("TIMEOUT")) return { code: "CONNECTION_TIMEOUT", status: "UNREACHABLE", message: "The Relay health check timed out" };
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code) || /could not be resolved/i.test(value.message ?? "")) return { code: "DNS_ERROR", status: "UNREACHABLE", message: "The WooCommerce hostname could not be resolved" };
  if (/CERT|TLS|SSL/i.test(code) || /certificate|tls|ssl/i.test(value.message ?? "")) return { code: "TLS_ERROR", status: "UNREACHABLE", message: "The WooCommerce TLS connection failed" };
  if (error instanceof SyntaxError) return { code: "INVALID_RELAY_RESPONSE", status: "ERROR", message: "The Relay returned an invalid response" };
  return { code: "RELAY_UNAVAILABLE", status: "UNREACHABLE", message: "The WooCommerce Relay is unreachable" };
}

function privateRequestFailure(error: unknown): RelayError {
  if (error instanceof RelayError) return error;
  const failure = normalizedFailure(error);
  if (failure.code === "CONNECTION_TIMEOUT") return new RelayError(504, failure.code, "WooCommerce order verification timed out");
  if (failure.code === "DNS_ERROR" || failure.code === "TLS_ERROR") return new RelayError(502, failure.code, failure.message);
  return new RelayError(502, "RELAY_UNAVAILABLE", "The WooCommerce Relay is unavailable");
}

function remoteOrderError(status: number, responseText: string): RelayError {
  let remoteCode = "";
  try {
    remoteCode = wordpressErrorSchema.safeParse(JSON.parse(responseText)).data?.code ?? "";
  } catch {
    // The response is normalized below without exposing its body.
  }

  if (remoteCode === "orbit_merchant_mismatch") return new RelayError(403, "MERCHANT_MISMATCH", "The Relay merchant configuration does not match this ORBIT merchant");
  if (remoteCode === "orbit_order_not_found") return new RelayError(404, "ORDER_NOT_FOUND", "WooCommerce order not found");
  if (remoteCode === "orbit_woocommerce_unavailable") return new RelayError(503, "WOOCOMMERCE_UNAVAILABLE", "WooCommerce is unavailable");
  if (["orbit_auth_missing", "orbit_timestamp_invalid", "orbit_timestamp_expired", "orbit_nonce_invalid", "orbit_replay_rejected", "orbit_signature_invalid"].includes(remoteCode) || status === 401) {
    return new RelayError(401, "INVALID_HMAC", "Private Relay authentication failed");
  }
  return new RelayError(502, "RELAY_UNAVAILABLE", "The WooCommerce Relay is unavailable");
}

export async function checkWooCommerceRelayHealth(merchantId: string) {
  const db = getDatabase();
  const integration = await db.wooCommerceRelayIntegration.findUnique({ where: { merchantId } });
  if (!integration) throw new RelayError(409, "RELAY_NOT_CONFIGURED", "Configure ORBIT Relay before testing the connection");
  if (!integration.connectionEnabled) throw new RelayError(409, "RELAY_DISABLED", "Enable ORBIT Relay before testing the connection");

  const checkedAt = new Date();
  const startedAt = Date.now();
  let status: RelayConnectionStatus = "ERROR";
  let errorCode: RelayErrorCode | null = null;
  let message = "The Relay returned an invalid response";
  let relayVersion: string | null = null;
  let woocommerceAvailable: boolean | null = null;
  let requestSucceeded = false;

  try {
    const response = await safeFetchText(`${integration.baseUrl}/wp-json/orbit/v1/health`, { timeoutMs: 6_000, maxBytes: 32_768, maxRedirects: 0, accept: "application/json" });
    if (response.status < 200 || response.status >= 300) {
      status = "RELAY_UNAVAILABLE";
      errorCode = "RELAY_UNAVAILABLE";
      message = "The Relay health endpoint is unavailable";
    } else {
      const parsed = healthSchema.safeParse(JSON.parse(response.text));
      if (!parsed.success || parsed.data.service !== "orbit-relay") {
        status = "ERROR";
        errorCode = "INVALID_RELAY_RESPONSE";
      } else {
        requestSucceeded = true;
        relayVersion = parsed.data.version;
        woocommerceAvailable = parsed.data.woocommerce;
        if (!parsed.data.ok) {
          status = "RELAY_UNAVAILABLE";
          errorCode = "RELAY_UNAVAILABLE";
          message = "The Relay plugin reported that it is unavailable";
        } else if (!parsed.data.woocommerce) {
          status = "WOO_UNAVAILABLE";
          errorCode = "WOOCOMMERCE_UNAVAILABLE";
          message = "The Relay is online, but WooCommerce is unavailable";
        } else {
          status = "CONNECTED";
          errorCode = null;
          message = "ORBIT Relay and WooCommerce are reachable";
        }
      }
    }
  } catch (error) {
    const failure = normalizedFailure(error);
    status = failure.status;
    errorCode = failure.code;
    message = failure.message;
  }

  const latencyMs = Math.max(0, Date.now() - startedAt);
  const updated = await db.wooCommerceRelayIntegration.update({ where: { id: integration.id }, data: {
    connectionStatus: status,
    relayVersion,
    woocommerceAvailable,
    lastHealthCheckAt: checkedAt,
    lastLatencyMs: latencyMs,
    lastErrorCode: errorCode,
    ...(requestSucceeded ? { lastSuccessfulRequestAt: checkedAt } : {}),
  } });
  return { ...safeRelayIntegration(updated), ok: status === "CONNECTED", message };
}

export type VerifiedWooCommerceOrder = {
  orderId: number;
  status: string;
  currency: string;
  totalMinor: number;
  paymentRequired: boolean;
  privateAuthentication: "VERIFIED";
};

export async function verifyWooCommerceOrder(merchantId: string, orderId: number): Promise<VerifiedWooCommerceOrder> {
  if (!Number.isSafeInteger(orderId) || orderId <= 0) throw new RelayError(400, "ORDER_NOT_FOUND", "Enter a valid WooCommerce order ID");

  const db = getDatabase();
  const integration = await db.wooCommerceRelayIntegration.findUnique({ where: { merchantId } });
  if (!integration) throw new RelayError(409, "RELAY_NOT_CONFIGURED", "Configure ORBIT Relay before verifying an order");
  if (!integration.connectionEnabled) throw new RelayError(409, "RELAY_DISABLED", "Enable ORBIT Relay before verifying an order");

  const path = `/wp-json/orbit/v1/orders/${orderId}`;
  const secret = decryptRelaySecret(integration.encryptedSigningSecret, merchantId);
  const headers = createOrbitRelayAuthHeaders({ merchantId, method: "GET", path, rawBody: "", secret });

  try {
    const response = await safeFetchText(`${integration.baseUrl}${path}`, {
      timeoutMs: 8_000,
      maxBytes: 32_768,
      maxRedirects: 0,
      accept: "application/json",
      headers,
    });
    if (response.status < 200 || response.status >= 300) throw remoteOrderError(response.status, response.text);

    let json: unknown;
    try {
      json = JSON.parse(response.text);
    } catch {
      throw new RelayError(502, "INVALID_RELAY_RESPONSE", "The Relay returned an invalid order response");
    }
    const parsed = orderSchema.safeParse(json);
    if (!parsed.success || parsed.data.order_id !== orderId) throw new RelayError(502, "INVALID_RELAY_RESPONSE", "The Relay returned an invalid order response");

    await db.wooCommerceRelayIntegration.update({
      where: { id: integration.id },
      data: { connectionStatus: "CONNECTED", lastSuccessfulRequestAt: new Date(), lastErrorCode: null },
    });

    if (parsed.data.paid) throw new RelayError(409, "ORDER_ALREADY_PAID", "This WooCommerce order is already paid");

    return {
      orderId: parsed.data.order_id,
      status: parsed.data.status,
      currency: parsed.data.currency,
      totalMinor: parsed.data.total_minor,
      paymentRequired: parsed.data.payment_required,
      privateAuthentication: "VERIFIED",
    };
  } catch (error) {
    throw privateRequestFailure(error);
  }
}
