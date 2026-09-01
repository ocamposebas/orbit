import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { WooCommerceInstallation } from "@/generated/prisma/client";
import { calculatePlatformFeeMinor, createPaymentCheckoutForTransaction } from "@/payments/service";
import { assertSupportedStripeCurrency } from "@/payments/currencies";
import { parseAppUrlConfiguration } from "@/sentinel/app-url";
import { getServerEnv } from "@/sentinel/config";
import { getDatabase } from "@/sentinel/db";
import { HttpError } from "@/sentinel/http";
import { safeFetchText } from "@/sentinel/security/ssrf";
import { createWooCommerceAuthHeaders } from "./auth";
import { decryptInstallationSecret, decryptWooCommerceValue, encryptWooCommerceValue } from "./installation-crypto";

const SESSION_TTL_MS = 60 * 60_000;
const SESSION_ID_PATTERN = /^(?:ops|ors)_[A-Za-z0-9_-]{6,}$/;
const terminalOrderStatuses = new Set(["completed", "processing", "refunded", "cancelled", "canceled", "trash"]);

const orderIdSchema = z.union([
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER).transform(String),
  z.string().regex(/^[1-9]\d{0,15}$/),
]);

const optionalPluginId = (pattern: RegExp) => z.preprocess(
  (value) => value === "" ? null : value,
  z.string().regex(pattern).optional().nullable(),
);

const authoritativeOrderSchema = z.object({
  order_id: orderIdSchema,
  order_number: z.union([z.string(), z.number()]).transform(String),
  status: z.string().trim().min(1).max(64).transform((value) => value.toLowerCase()),
  currency: z.string().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()),
  total_minor: z.number().int().positive().max(2_147_483_647),
  payment_required: z.boolean(),
  paid: z.boolean(),
  date_created: z.string().trim().min(1).max(64).nullable(),
  orbit_session_id: optionalPluginId(SESSION_ID_PATTERN),
  orbit_payment_id: optionalPluginId(/^pay_[A-Za-z0-9_-]{6,}$/),
});

type Installation = Pick<WooCommerceInstallation, "id" | "merchantId" | "origin" | "environment" | "encryptedSigningSecret" | "enabled" | "hostedPaymentsEnabled" | "revokedAt"> & { publicMerchantId: string };

function randomId(prefix: string, bytes: number) {
  return `${prefix}${randomBytes(bytes).toString("base64url")}`;
}

function paymentOrigin() {
  const env = getServerEnv();
  let url: URL;
  try { url = new URL(env.ORBIT_PAYMENTS_PUBLIC_ORIGIN ?? parseAppUrlConfiguration(env.APP_URL).canonicalOrigin); }
  catch { throw new HttpError(503, "The hosted payment origin is not configured correctly"); }
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new HttpError(503, "The hosted payment origin is not configured correctly");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new HttpError(503, "The hosted payment origin must use HTTPS");
  return url.origin;
}

function validateReturnUrl(value: string | null | undefined, installation: Installation, fallbackPath = "/") {
  const candidate = value ?? new URL(fallbackPath, `${installation.origin}/`).toString();
  let url: URL;
  try { url = new URL(candidate); }
  catch { throw new HttpError(422, "WooCommerce returned an invalid customer return URL"); }
  if (url.origin !== installation.origin || url.username || url.password) throw new HttpError(422, "WooCommerce return URL does not match the connected site");
  if (installation.environment === "LIVE" && url.protocol !== "https:") throw new HttpError(422, "WooCommerce live return URL must use HTTPS");
  return url.toString();
}

function remoteOrderError(status: number, text: string) {
  let code = "";
  try { code = String((JSON.parse(text) as { code?: unknown }).code ?? ""); } catch { /* response is normalized below */ }
  if (status === 404 || code === "orbit_order_not_found") return new HttpError(404, "WooCommerce order not found");
  if (status === 401 || status === 403 || code.includes("auth") || code.includes("merchant_mismatch")) return new HttpError(502, "WooCommerce rejected ORBIT authentication");
  return new HttpError(502, "WooCommerce order verification is temporarily unavailable");
}

export async function retrieveAuthoritativeWooCommerceOrder(installation: Installation, orderId: string) {
  const path = `/wp-json/orbit-payments/v1/orders/${encodeURIComponent(orderId)}`;
  const secret = decryptInstallationSecret(installation.encryptedSigningSecret, installation.id);
  const headers = createWooCommerceAuthHeaders({
    merchantId: installation.publicMerchantId,
    installationId: installation.id,
    method: "GET",
    path,
    rawBody: "",
    secret,
  });
  const response = await safeFetchText(`${installation.origin}${path}`, {
    timeoutMs: 8_000,
    maxBytes: 32_768,
    maxRedirects: 0,
    accept: "application/json",
    headers,
  });
  if (response.url.origin !== installation.origin) throw new HttpError(502, "WooCommerce order verification changed origin");
  if (response.status < 200 || response.status >= 300) throw remoteOrderError(response.status, response.text);
  let value: unknown;
  try { value = JSON.parse(response.text); } catch { throw new HttpError(502, "WooCommerce returned an invalid order response"); }
  const parsed = authoritativeOrderSchema.safeParse(value);
  if (!parsed.success || parsed.data.order_id !== orderId) throw new HttpError(502, "WooCommerce returned an invalid order response");
  if (parsed.data.paid) throw new HttpError(409, "WooCommerce order is already paid");
  if (!parsed.data.payment_required || terminalOrderStatuses.has(parsed.data.status)) throw new HttpError(409, "WooCommerce order is not payable");
  assertSupportedStripeCurrency(parsed.data.currency);
  return parsed.data;
}

function idempotencyKey(installation: Installation, orderId: string) {
  return createHash("sha256")
    .update([installation.merchantId, installation.id, orderId, installation.environment].join("\n"), "utf8")
    .digest("hex");
}

function transactionOrderKey(installationId: string, orderId: string) {
  return `woocommerce:${installationId}:${orderId}`;
}

export async function createOrReuseWooCommercePaymentSession(input: {
  installation: Installation;
  orderId: string;
  returnUrl: string;
  cancelUrl: string;
  callbackUrl: string;
  pluginIdempotencyKey: string;
}) {
  const installation = input.installation;
  if (!installation.enabled || !installation.hostedPaymentsEnabled || installation.revokedAt) throw new HttpError(403, "WooCommerce installation is disabled");
  const order = await retrieveAuthoritativeWooCommerceOrder(installation, input.orderId);
  const successReturnUrl = validateReturnUrl(input.returnUrl, installation);
  const cancelReturnUrl = validateReturnUrl(input.cancelUrl, installation, "/checkout/");
  const callback = new URL(input.callbackUrl);
  if (callback.origin !== installation.origin || callback.pathname !== "/wp-json/orbit-payments/v1/events" || callback.search || callback.hash || callback.username || callback.password) {
    throw new HttpError(422, "WooCommerce callback URL does not match the connected installation");
  }
  const key = idempotencyKey(installation, order.order_id);
  const db = getDatabase();
  const existing = await db.paymentSession.findUnique({ where: { idempotencyKey: key }, include: { paymentTransaction: true } });
  if (order.orbit_session_id && order.orbit_session_id !== existing?.id) throw new HttpError(409, "WooCommerce reports a conflicting ORBIT payment session");
  if (order.orbit_payment_id && order.orbit_payment_id !== existing?.paymentTransaction.publicPaymentId) throw new HttpError(409, "WooCommerce reports a conflicting ORBIT payment");
  if (existing) {
    if (existing.merchantId !== installation.merchantId || existing.installationId !== installation.id || existing.platformOrderId !== order.order_id) {
      throw new HttpError(409, "WooCommerce payment session conflicts with this order");
    }
    if (existing.paymentTransaction.stripePaymentIntentId && (existing.amountMinor !== order.total_minor || existing.currency !== order.currency)) {
      throw new HttpError(409, "WooCommerce order changed after payment was prepared");
    }
    const mutable = !["SUCCEEDED", "CANCELED"].includes(existing.paymentTransaction.status);
    const refreshedExpiresAt = new Date(Date.now() + SESSION_TTL_MS);
    if (mutable) {
      await db.$transaction([
        db.paymentSession.update({ where: { id: existing.id }, data: {
          amountMinor: order.total_minor,
          currency: order.currency,
          status: existing.paymentTransaction.status === "PROCESSING" ? "PROCESSING" : "PENDING",
          expiresAt: refreshedExpiresAt,
          encryptedSuccessReturnUrl: encryptWooCommerceValue(successReturnUrl, "success-return", existing.id),
          encryptedCancelReturnUrl: encryptWooCommerceValue(cancelReturnUrl, "cancel-return", existing.id),
          metadata: { orderReference: order.order_number, pluginIdempotencyKey: input.pluginIdempotencyKey },
        } }),
        ...(!existing.paymentTransaction.stripePaymentIntentId ? [db.paymentTransaction.update({ where: { id: existing.paymentTransactionId }, data: {
          amountMinor: order.total_minor,
          currency: order.currency,
          externalReference: order.order_id,
          platformFeeMinor: calculatePlatformFeeMinor(order.total_minor, existing.paymentTransaction.platformFeeBps),
        } })] : []),
      ]);
    }
    return { id: existing.id, expiresAt: mutable ? refreshedExpiresAt : existing.expiresAt };
  }

  const merchant = await db.merchant.findUnique({ where: { id: installation.merchantId }, select: {
    id: true,
    platformFeeBps: true,
    stripeConnect: { select: { stripeAccountId: true, cardPaymentsStatus: true } },
  } });
  if (!merchant) throw new HttpError(404, "Merchant not found");
  if (merchant.platformFeeBps === null) throw new HttpError(409, "Configure the merchant platform fee before accepting payments");
  if (!merchant.stripeConnect || merchant.stripeConnect.cardPaymentsStatus?.toLowerCase() !== "active") throw new HttpError(409, "STRIPE_NOT_READY");
  const platformFeeMinor = calculatePlatformFeeMinor(order.total_minor, merchant.platformFeeBps);
  if (platformFeeMinor <= 0 || platformFeeMinor >= order.total_minor) throw new HttpError(422, "The configured application fee is invalid for this order total");
  const sessionId = randomId("ops_", 24);
  const transactionId = randomId("orb_tx_", 18);
  const publicPaymentId = randomId("pay_", 18);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  try {
    await db.$transaction(async (tx) => {
      await tx.paymentTransaction.create({ data: {
        id: transactionId,
        publicPaymentId,
        merchantId: installation.merchantId,
        wooOrderId: transactionOrderKey(installation.id, order.order_id),
        stripeAccountId: merchant.stripeConnect!.stripeAccountId,
        amountMinor: order.total_minor,
        currency: order.currency,
        platformFeeBps: merchant.platformFeeBps!,
        platformFeeMinor,
        status: "REQUIRES_PAYMENT",
        source: "WOOCOMMERCE",
        externalReference: order.order_id,
      } });
      await tx.paymentSession.create({ data: {
        id: sessionId,
        merchantId: installation.merchantId,
        installationId: installation.id,
        paymentTransactionId: transactionId,
        platform: "WOOCOMMERCE",
        environment: installation.environment,
        platformOrderId: order.order_id,
        idempotencyKey: key,
        amountMinor: order.total_minor,
        currency: order.currency,
        encryptedSuccessReturnUrl: encryptWooCommerceValue(successReturnUrl, "success-return", sessionId),
        encryptedCancelReturnUrl: encryptWooCommerceValue(cancelReturnUrl, "cancel-return", sessionId),
        expiresAt,
        metadata: { orderReference: order.order_number, pluginIdempotencyKey: input.pluginIdempotencyKey },
      } });
    });
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) throw error;
    const concurrent = await db.paymentSession.findUnique({ where: { idempotencyKey: key } });
    if (!concurrent) throw error;
    return { id: concurrent.id, expiresAt: concurrent.expiresAt };
  }
  return { id: sessionId, expiresAt };
}

export function wooCommerceCheckoutUrl(sessionId: string) {
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new HttpError(404, "Payment session not found");
  return `${paymentOrigin()}/p/${encodeURIComponent(sessionId)}`;
}

export function isHostedPaymentSessionId(value: string) {
  return SESSION_ID_PATTERN.test(value);
}

function sessionMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, unknown>;
  return value as Record<string, unknown>;
}

export async function getPublicWooCommerceCheckout(sessionId: string) {
  if (!isHostedPaymentSessionId(sessionId)) throw new HttpError(404, "Payment session not found");
  const session = await getDatabase().paymentSession.findUnique({ where: { id: sessionId }, include: {
    paymentTransaction: { select: { status: true } },
    merchant: { select: { businessName: true } },
    installation: { select: { enabled: true, hostedPaymentsEnabled: true, revokedAt: true } },
    eventDeliveries: { where: { type: "payment.succeeded" }, take: 1, select: { status: true } },
  } });
  if (!session || session.platform !== "WOOCOMMERCE") throw new HttpError(404, "Payment session not found");
  const metadata = sessionMetadata(session.metadata);
  const expired = session.expiresAt.getTime() <= Date.now() && session.paymentTransaction.status !== "SUCCEEDED";
  const deliveryStatus = session.eventDeliveries[0]?.status ?? "PENDING";
  return {
    id: session.id,
    platform: "WOOCOMMERCE" as const,
    merchantName: session.merchant.businessName,
    orderReference: String(metadata.orderReference ?? session.platformOrderId),
    amountMinor: session.amountMinor,
    currency: session.currency,
    email: typeof metadata.customerEmail === "string" ? metadata.customerEmail : null,
    paymentStatus: session.paymentTransaction.status,
    syncStatus: deliveryStatus,
    checkoutMode: "ORBIT_HOSTED" as const,
    expired,
    disabled: !session.installation.enabled || !session.installation.hostedPaymentsEnabled || Boolean(session.installation.revokedAt),
    returnReady: session.paymentTransaction.status === "SUCCEEDED" && deliveryStatus === "DELIVERED",
  };
}

export async function createWooCommerceSessionCheckout(sessionId: string) {
  const session = await getDatabase().paymentSession.findUnique({ where: { id: sessionId }, include: { installation: true, paymentTransaction: true } });
  if (!session || session.platform !== "WOOCOMMERCE") throw new HttpError(404, "Payment session not found");
  if (!session.installation.enabled || !session.installation.hostedPaymentsEnabled || session.installation.revokedAt) throw new HttpError(403, "WooCommerce installation is disabled");
  if (session.expiresAt.getTime() <= Date.now()) throw new HttpError(410, "This payment session has expired");
  if (["SUCCEEDED", "CANCELED"].includes(session.paymentTransaction.status)) throw new HttpError(409, "This payment session cannot accept another payment");
  return createPaymentCheckoutForTransaction(session.merchantId, session.paymentTransactionId, "WOOCOMMERCE");
}

export async function wooCommerceCustomerReturnUrl(sessionId: string, kind: "success" | "cancel" = "success") {
  const session = await getDatabase().paymentSession.findUnique({ where: { id: sessionId }, select: {
    encryptedSuccessReturnUrl: true,
    encryptedCancelReturnUrl: true,
  } });
  if (!session) throw new HttpError(404, "Payment session not found");
  return kind === "cancel"
    ? decryptWooCommerceValue(session.encryptedCancelReturnUrl, "cancel-return", sessionId)
    : decryptWooCommerceValue(session.encryptedSuccessReturnUrl, "success-return", sessionId);
}
