import { getServerEnv } from "@/sentinel/config";
import { HttpError } from "@/sentinel/http";

export type EcwidConfiguration = {
  enabled: true;
  storeId: string;
  clientId: string;
  clientSecret: string;
  secretToken: string;
  merchantId: string;
  checkoutMode: "STRIPE_CHECKOUT" | "ORBIT_HOSTED";
};

export function ecwidEnabled() {
  return getServerEnv().ECWID_ENABLED;
}

export function ecwidCheckoutMode(): "STRIPE_CHECKOUT" | "ORBIT_HOSTED" {
  const value = process.env.ECWID_CHECKOUT_MODE?.trim() || "STRIPE_CHECKOUT";
  if (value !== "STRIPE_CHECKOUT" && value !== "ORBIT_HOSTED") throw new HttpError(503, "Ecwid checkout mode is invalid");
  return value;
}

export function getEcwidConfiguration(): EcwidConfiguration {
  const env = getServerEnv();
  if (!env.ECWID_ENABLED) throw new HttpError(503, "Ecwid payments are not enabled");
  const values = {
    storeId: env.ECWID_STORE_ID,
    clientId: env.ECWID_CLIENT_ID,
    clientSecret: env.ECWID_CLIENT_SECRET,
    secretToken: env.ECWID_SECRET_TOKEN,
    merchantId: env.ECWID_ORBIT_MERCHANT_ID,
    checkoutMode: ecwidCheckoutMode(),
  };
  if (!values.storeId || !/^\d{1,20}$/.test(values.storeId)) throw new HttpError(503, "Ecwid store configuration is incomplete");
  if (!values.clientId || values.clientId.length > 160) throw new HttpError(503, "Ecwid app configuration is incomplete");
  if (!values.clientSecret || values.clientSecret.length < 16 || values.clientSecret.length > 512) throw new HttpError(503, "Ecwid app configuration is incomplete");
  if (!values.secretToken || values.secretToken.length > 512) throw new HttpError(503, "Ecwid API configuration is incomplete");
  if (!values.merchantId || values.merchantId.length > 160) throw new HttpError(503, "Ecwid merchant mapping is incomplete");
  return { enabled: true, ...values } as EcwidConfiguration;
}

export function getEcwidPublicCheckoutOrigin() {
  const env = getServerEnv();
  const publicCheckoutUrl = new URL(process.env.ECWID_PUBLIC_CHECKOUT_ORIGIN?.trim() || env.APP_URL);
  if (publicCheckoutUrl.username || publicCheckoutUrl.password || publicCheckoutUrl.pathname !== "/" || publicCheckoutUrl.search || publicCheckoutUrl.hash) {
    throw new HttpError(503, "Ecwid public checkout origin is invalid");
  }
  if (process.env.NODE_ENV === "production" && publicCheckoutUrl.protocol !== "https:") {
    throw new HttpError(503, "Ecwid public checkout origin must use HTTPS");
  }
  if (!["https:", "http:"].includes(publicCheckoutUrl.protocol)) throw new HttpError(503, "Ecwid public checkout origin is invalid");
  return publicCheckoutUrl.origin;
}
