import { z } from "zod";
import { UnsafeTargetError, validatePublicUrl } from "@/sentinel/security/ssrf";
import { RelayError, type RelayEnvironment } from "./types";

const optionalSigningSecret = z.preprocess(
  (value) => value === "" ? undefined : value,
  z.string().min(16, "Signing secret must contain at least 16 characters").max(1_024).refine((value) => value === value.trim(), "Signing secret cannot begin or end with whitespace").optional(),
);

export const relayConfigurationSchema = z.object({
  baseUrl: z.string().trim().min(1).max(2_048),
  environment: z.enum(["PRODUCTION", "STAGING"]),
  signingSecret: optionalSigningSecret,
  connectionEnabled: z.boolean(),
  platformFeeBps: z.number().int().min(0).max(10_000).optional(),
});

export function normalizeWooCommerceBaseUrl(input: string, environment: RelayEnvironment) {
  let url: URL;
  try { url = new URL(input); }
  catch { throw new RelayError(400, "INVALID_WOOCOMMERCE_URL", "Enter a valid WooCommerce base URL"); }
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new RelayError(400, "INVALID_WOOCOMMERCE_URL", "WooCommerce URL must be a canonical HTTP or HTTPS origin without credentials, paths, query strings, or fragments");
  }
  if (environment === "PRODUCTION" && url.protocol !== "https:") {
    throw new RelayError(400, "INVALID_WOOCOMMERCE_URL", "Production WooCommerce Relay URLs must use HTTPS");
  }
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  return url.origin;
}

export async function validateWooCommerceBaseUrl(input: string, environment: RelayEnvironment) {
  const baseUrl = normalizeWooCommerceBaseUrl(input, environment);
  try { await validatePublicUrl(baseUrl); }
  catch (error) {
    if (error instanceof UnsafeTargetError) throw new RelayError(400, "INVALID_WOOCOMMERCE_URL", "WooCommerce URL must resolve to a public, non-reserved destination");
    throw error;
  }
  return baseUrl;
}
