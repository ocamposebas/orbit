import { z } from "zod";
import { getDatabase } from "@/sentinel/db";
import { safeFetchText } from "@/sentinel/security/ssrf";
import { RelayError, type RelayConnectionStatus, type RelayErrorCode } from "./types";

const healthSchema = z.object({
  ok: z.boolean(),
  service: z.string(),
  woocommerce: z.boolean(),
  version: z.string().trim().min(1).max(64),
});

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
