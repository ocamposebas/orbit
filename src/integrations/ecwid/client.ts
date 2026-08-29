import { getEcwidConfiguration } from "./config";
import type { EcwidTargetStatus } from "./types";

const ECWID_API_ORIGIN = "https://app.ecwid.com";
const REQUEST_TIMEOUT_MS = 8_000;

export class EcwidApiError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super("Ecwid order synchronization failed");
    this.name = "EcwidApiError";
  }
}

export async function updateEcwidPaymentStatus(
  referenceTransactionId: string,
  paymentStatus: EcwidTargetStatus,
  externalTransactionId?: string,
) {
  const config = getEcwidConfiguration();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const endpoint = new URL(
      `/api/v3/${encodeURIComponent(config.storeId)}/orders/${encodeURIComponent(referenceTransactionId)}`,
      ECWID_API_ORIGIN,
    );
    const response = await fetch(endpoint, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${config.secretToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ paymentStatus, ...(externalTransactionId ? { externalTransactionId } : {}) }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new EcwidApiError(`ecwid_http_${response.status}`, response.status === 429 || response.status >= 500, response.status);
    }
    const result = await response.json().catch(() => null) as { updateCount?: unknown } | null;
    if (!result || result.updateCount !== 1) throw new EcwidApiError("ecwid_invalid_update_response", true);
  } catch (error) {
    if (error instanceof EcwidApiError) throw error;
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new EcwidApiError(aborted ? "ecwid_timeout" : "ecwid_network_error", true);
  } finally {
    clearTimeout(timeout);
  }
}
