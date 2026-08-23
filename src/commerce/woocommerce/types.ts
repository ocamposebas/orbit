import { HttpError } from "@/sentinel/http";

export type RelayEnvironment = "PRODUCTION" | "STAGING";
export type RelayConnectionStatus = "NOT_CONFIGURED" | "CONFIGURED" | "CONNECTED" | "UNREACHABLE" | "WOO_UNAVAILABLE" | "RELAY_UNAVAILABLE" | "AUTH_NOT_TESTED" | "ERROR";
export type RelayErrorCode = "RELAY_NOT_CONFIGURED" | "RELAY_DISABLED" | "INVALID_WOOCOMMERCE_URL" | "CONNECTION_TIMEOUT" | "DNS_ERROR" | "TLS_ERROR" | "RELAY_UNAVAILABLE" | "WOOCOMMERCE_UNAVAILABLE" | "INVALID_RELAY_RESPONSE" | "INVALID_HMAC" | "MERCHANT_MISMATCH" | "ORDER_NOT_FOUND" | "ORDER_ALREADY_PAID" | "UNKNOWN";

export class RelayError extends HttpError {
  constructor(status: number, readonly code: RelayErrorCode, message: string) {
    super(status, message);
    this.name = "RelayError";
  }
}
