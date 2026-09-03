import Stripe from "stripe";
import { getServerEnv } from "@/sentinel/config";
import { HttpError } from "@/sentinel/http";

export type StripeMode = "test" | "live";
export type StripeAccountApi = "v1" | "v2";

export function inspectStripeKey(secretKey: string | undefined, configuredMode: StripeMode) {
  if (!secretKey) return { configured: false as const, mode: configuredMode };
  const keyMode = /^(?:sk|rk)_test_/.test(secretKey) ? "test" : /^(?:sk|rk)_live_/.test(secretKey) ? "live" : undefined;
  if (!keyMode) throw new HttpError(503, "Stripe is configured with an unsupported secret key format");
  if (keyMode !== configuredMode) throw new HttpError(503, `Stripe key environment does not match STRIPE_MODE=${configuredMode}`);
  return { configured: true as const, mode: configuredMode, keyMode };
}

export function inspectStripePublishableKey(publishableKey: string | undefined, configuredMode: StripeMode) {
  if (!publishableKey) throw new HttpError(503, "Stripe's browser integration is not configured");
  const keyMode = publishableKey.startsWith("pk_test_") ? "test" : publishableKey.startsWith("pk_live_") ? "live" : undefined;
  if (!keyMode) throw new HttpError(503, "Stripe is configured with an unsupported publishable key format");
  if (keyMode !== configuredMode) throw new HttpError(503, `Stripe publishable key environment does not match STRIPE_MODE=${configuredMode}`);
  return publishableKey;
}

export function getStripePublishableKey() {
  const env = getServerEnv();
  return inspectStripePublishableKey(env.STRIPE_PUBLISHABLE_KEY, env.STRIPE_MODE);
}

export function getStripeConfiguration() {
  const env = getServerEnv();
  const state = inspectStripeKey(env.STRIPE_SECRET_KEY, env.STRIPE_MODE);
  return { ...state, accountApi: env.STRIPE_CONNECT_ACCOUNT_API, webhookConfigured: Boolean(env.STRIPE_CONNECT_WEBHOOK_SECRET), platformPaymentsWebhookConfigured: Boolean(env.STRIPE_PLATFORM_PAYMENTS_WEBHOOK_SECRET), apiVersion: env.STRIPE_API_VERSION };
}

export function getStripeClient() {
  const env = getServerEnv();
  const state = inspectStripeKey(env.STRIPE_SECRET_KEY, env.STRIPE_MODE);
  if (!state.configured || !env.STRIPE_SECRET_KEY) throw new HttpError(503, "Stripe Connect is not configured");
  return new Stripe(env.STRIPE_SECRET_KEY, {
    ...(env.STRIPE_API_VERSION ? { apiVersion: env.STRIPE_API_VERSION as Stripe.LatestApiVersion } : {}),
    appInfo: { name: "ORBIT Stripe Connect verification", version: "1.0.0" },
    maxNetworkRetries: 2,
    timeout: 20_000,
  });
}

export function expectedLivemode(mode: StripeMode) { return mode === "live"; }

export function assertStripeEnvironment(livemode: boolean, mode: StripeMode) {
  if (livemode !== expectedLivemode(mode)) throw new HttpError(409, `Stripe account environment does not match ORBIT Stripe mode (${mode})`);
}

export function stripeEnvironment(mode: StripeMode) { return mode === "live" ? "LIVE" as const : "TEST" as const; }

export function stripeApiUnavailable(error: unknown, api: StripeAccountApi) {
  if (api !== "v2") return false;
  const value = error as { type?: string; code?: string; statusCode?: number; message?: string };
  return value.statusCode === 404 || value.code === "resource_missing" || /accounts v2|v2\/core\/accounts|not enabled|not available|not supported|preview/i.test(value.message ?? "");
}
