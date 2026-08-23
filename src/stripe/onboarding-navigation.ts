import { z } from "zod";
import { getServerEnv } from "@/sentinel/config";
import { HttpError } from "@/sentinel/http";

const merchantIdSchema = z.cuid();

export function requireValidMerchantId(value: string) {
  if (!merchantIdSchema.safeParse(value).success) throw new HttpError(400, "Invalid merchant return request");
  return value;
}

export function canonicalOrbitOrigin(appUrl = getServerEnv().APP_URL) {
  const url = new URL(appUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new HttpError(503, "APP_URL must be the canonical ORBIT HTTPS origin");
  }
  return url.origin;
}

export function merchantStripeDashboardPath(merchantId: string, result: "login" | "success" | "error" = "login") {
  requireValidMerchantId(merchantId);
  const stripeReturn = result === "success" ? "1" : result;
  return `/sentinel/merchant/${encodeURIComponent(merchantId)}?stripeReturn=${stripeReturn}#stripe-connect`;
}

export function stripeRefreshPath(merchantId: string) {
  requireValidMerchantId(merchantId);
  return `/merchants/${encodeURIComponent(merchantId)}/integrations/stripe/refresh`;
}

export function stripeOnboardingUrls(merchantId: string, appUrl = getServerEnv().APP_URL) {
  requireValidMerchantId(merchantId);
  const origin = canonicalOrbitOrigin(appUrl);
  const encodedMerchantId = encodeURIComponent(merchantId);
  return {
    returnUrl: `${origin}/merchants/${encodedMerchantId}/integrations/stripe/return`,
    refreshUrl: `${origin}/merchants/${encodedMerchantId}/integrations/stripe/refresh`,
  };
}

export function orbitRedirectUrl(path: string, appUrl = getServerEnv().APP_URL) {
  return new URL(path, `${canonicalOrbitOrigin(appUrl)}/`);
}

export function orbitLoginUrl(continuation: string, appUrl = getServerEnv().APP_URL) {
  const login = orbitRedirectUrl("/login", appUrl);
  login.searchParams.set("next", continuation);
  return login;
}
