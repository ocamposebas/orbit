import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { apiError, HttpError } from "@/sentinel/http";
import { childLogger } from "@/sentinel/logger";
import { RelayError, type RelayErrorCode } from "./types";

const log = childLogger({ component: "woo-relay-api" });

export function relayErrorCode(error: unknown): RelayErrorCode {
  return error instanceof RelayError ? error.code : "UNKNOWN";
}

export function relayApiError(error: unknown) {
  if (error instanceof RelayError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store, private" } });
  if (error instanceof HttpError || error instanceof ZodError) return apiError(error);
  const value = error as { name?: unknown; code?: unknown };
  log.error({ errorName: String(value?.name ?? "Error").slice(0, 80), errorCode: String(value?.code ?? "UNKNOWN").slice(0, 80) }, "WooCommerce Relay request failed");
  return NextResponse.json({ error: "Unexpected server error", code: "UNKNOWN" }, { status: 500, headers: { "Cache-Control": "no-store, private" } });
}

export function parseWooCommerceJson(rawBody: string) {
  try { return JSON.parse(rawBody || "{}"); }
  catch { throw new HttpError(400, "Invalid JSON request body"); }
}
