import { randomBytes } from "node:crypto";
import type Stripe from "stripe";
import { calculatePlatformFeeMinor, paymentMethodConfigurationId } from "@/payments/service";
import { getDatabase } from "@/sentinel/db";
import { HttpError } from "@/sentinel/http";
import { childLogger } from "@/sentinel/logger";
import { getStripeClient, getStripeConfiguration, getStripePublishableKey, stripeEnvironment } from "@/stripe/client";

const log = childLogger({ component: "orbit-payment-links" });
const publicIdPattern = /^plink_[A-Za-z0-9_-]{16,64}$/;
const paymentIdPattern = /^plpay_[A-Za-z0-9_-]{16,64}$/;
const paymentLinkMethodTypes = ["card", "link"] as const;

function paymentId() { return `orb_plpay_${randomBytes(18).toString("base64url")}`; }
function paymentPublicId() { return `plpay_${randomBytes(18).toString("base64url")}`; }
function isUniqueConstraintError(error: unknown) { return typeof error === "object" && error !== null && "code" in error && error.code === "P2002"; }

function safeStripeFailure(error: unknown) {
  const value = error as { code?: string; type?: string; statusCode?: number };
  const code = String(value.code ?? value.type ?? "stripe_unavailable").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
  if (value.type === "StripeAuthenticationError" || value.statusCode === 401) return { code, error: new HttpError(503, "ORBIT Payment is temporarily unavailable") };
  if (value.type === "StripePermissionError" || value.statusCode === 403) return { code, error: new HttpError(503, "This ORBIT Payment account cannot accept this payment yet") };
  if (value.type === "StripeRateLimitError" || value.statusCode === 429) return { code, error: new HttpError(429, "Payment creation is busy. Try again shortly.") };
  return { code, error: new HttpError(502, "The secure payment service is temporarily unavailable") };
}

export type PublicOrbitPaymentLink = {
  publicId: string;
  title: string;
  description: string | null;
  amountMinor: number;
  currency: string;
  accountName: string;
  platformOwned: boolean;
  available: boolean;
  unavailableReason: "inactive" | "expired" | null;
};

export async function getPublicOrbitPaymentLink(publicId: string): Promise<PublicOrbitPaymentLink> {
  if (!publicIdPattern.test(publicId)) throw new HttpError(404, "Payment link not found");
  const link = await getDatabase().orbitPaymentLink.findUnique({
    where: { publicId },
    select: { publicId: true, title: true, description: true, amountMinor: true, currency: true, status: true, expiresAt: true, merchant: { select: { businessName: true } } },
  });
  if (!link) throw new HttpError(404, "Payment link not found");
  const expired = Boolean(link.expiresAt && link.expiresAt <= new Date());
  const inactive = link.status !== "ACTIVE";
  return {
    publicId: link.publicId,
    title: link.title,
    description: link.description,
    amountMinor: link.amountMinor,
    currency: link.currency,
    accountName: link.merchant?.businessName ?? "ORBIT",
    platformOwned: !link.merchant,
    available: !inactive && !expired,
    unavailableReason: inactive ? "inactive" : expired ? "expired" : null,
  };
}

function assertPaymentIntent(
  intent: Stripe.PaymentIntent,
  payment: { id: string; stripePaymentIntentId: string | null; amountMinor: number; currency: string; platformFeeMinor: number },
  link: { id: string; merchantId: string | null },
  expectedAccountId: string | null,
) {
  if (!intent.id.startsWith("pi_") || (payment.stripePaymentIntentId && intent.id !== payment.stripePaymentIntentId)) throw new Error("payment_intent_id_mismatch");
  if (intent.amount !== payment.amountMinor) throw new Error("payment_amount_mismatch");
  if (intent.currency.toUpperCase() !== payment.currency) throw new Error("payment_currency_mismatch");
  if ((intent.application_fee_amount ?? 0) !== payment.platformFeeMinor) throw new Error("application_fee_mismatch");
  if (intent.metadata.paymentSource !== "ORBIT_PAYMENT_LINK" || intent.metadata.orbitPaymentLinkId !== link.id || intent.metadata.orbitPaymentLinkPaymentId !== payment.id) throw new Error("payment_link_metadata_mismatch");
  if ((intent.metadata.merchantId || null) !== link.merchantId) throw new Error("merchant_metadata_mismatch");
  if (Boolean(expectedAccountId) !== Boolean(link.merchantId)) throw new Error("payment_destination_mismatch");
  if (!intent.payment_method_types.includes("card") || intent.payment_method_types.some((method) => !paymentLinkMethodTypes.includes(method as typeof paymentLinkMethodTypes[number]))) throw new Error("payment_method_configuration_mismatch");
}

export async function createOrbitPaymentLinkCheckout(publicId: string, checkoutKey: string) {
  if (!publicIdPattern.test(publicId)) throw new HttpError(404, "Payment link not found");
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(checkoutKey)) throw new HttpError(400, "Invalid checkout request");
  const db = getDatabase();
  const link = await db.orbitPaymentLink.findUnique({
    where: { publicId },
    include: { merchant: { select: { id: true, businessName: true, stripeConnect: { select: { stripeAccountId: true, stripeEnvironment: true, cardPaymentsStatus: true } } } } },
  });
  if (!link) throw new HttpError(404, "Payment link not found");
  if (link.status !== "ACTIVE") throw new HttpError(409, "This payment link is no longer active");
  if (link.expiresAt && link.expiresAt <= new Date()) throw new HttpError(409, "This payment link has expired");
  const config = getStripeConfiguration();
  if (!config.configured) throw new HttpError(503, "ORBIT Payment is not configured");
  if (!link.merchantId && !config.platformPaymentsWebhookConfigured) throw new HttpError(503, "ORBIT platform Payment Links need their signed Stripe webhook before accepting payments");
  const environment = stripeEnvironment(config.mode);
  if (link.stripeEnvironment !== environment) throw new HttpError(409, "This payment link belongs to a different payment environment");

  const accountId = link.merchant?.stripeConnect?.stripeAccountId ?? null;
  if (link.merchantId) {
    if (!link.merchant?.stripeConnect || !accountId) throw new HttpError(409, "This business is not connected to ORBIT Payment");
    if (link.merchant.stripeConnect.stripeEnvironment !== environment) throw new HttpError(409, "This business belongs to a different payment environment");
    if (link.merchant.stripeConnect.cardPaymentsStatus?.toLowerCase() !== "active") throw new HttpError(409, "This business cannot accept payments yet");
  }
  const platformFeeMinor = link.merchantId ? calculatePlatformFeeMinor(link.amountMinor, link.platformFeeBps ?? 0) : 0;
  if (link.merchantId && (platformFeeMinor <= 0 || platformFeeMinor >= link.amountMinor)) throw new HttpError(409, "This payment link has an invalid processing configuration");

  let payment = await db.orbitPaymentLinkPayment.findUnique({ where: { paymentLinkId_checkoutKey: { paymentLinkId: link.id, checkoutKey } } });
  if (!payment) {
    try {
      payment = await db.orbitPaymentLinkPayment.create({ data: {
        id: paymentId(), publicId: paymentPublicId(), paymentLinkId: link.id, checkoutKey,
        stripeAccountId: accountId, amountMinor: link.amountMinor, currency: link.currency, platformFeeMinor,
      } });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      payment = await db.orbitPaymentLinkPayment.findUnique({ where: { paymentLinkId_checkoutKey: { paymentLinkId: link.id, checkoutKey } } });
      if (!payment) throw error;
    }
  }
  if (!["CREATED", "REQUIRES_PAYMENT", "PROCESSING", "FAILED"].includes(payment.status)) throw new HttpError(409, "This checkout has already been completed");
  if (payment.amountMinor !== link.amountMinor || payment.currency !== link.currency || payment.stripeAccountId !== accountId || payment.platformFeeMinor !== platformFeeMinor) throw new HttpError(409, "This checkout no longer matches the approved payment link");

  const stripe = getStripeClient();
  const options: Stripe.RequestOptions = accountId ? { stripeContext: accountId } : {};
  try {
    let intent = payment.stripePaymentIntentId
      ? await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId, {}, options)
      : await stripe.paymentIntents.create({
        amount: payment.amountMinor,
        currency: payment.currency.toLowerCase(),
        ...(accountId ? { application_fee_amount: payment.platformFeeMinor, payment_method_configuration: paymentMethodConfigurationId() } : {}),
        payment_method_types: [...paymentLinkMethodTypes],
        description: link.title.slice(0, 255),
        ...(!accountId ? { statement_descriptor_suffix: "ORBIT" } : {}),
        metadata: {
          paymentSource: "ORBIT_PAYMENT_LINK",
          orbitPaymentLinkId: link.id,
          orbitPaymentLinkPublicId: link.publicId,
          orbitPaymentLinkPaymentId: payment.id,
          organizationId: link.organizationId,
          ...(link.merchantId ? { merchantId: link.merchantId } : {}),
        },
      }, { ...options, idempotencyKey: `orbit-payment-link-${payment.id}` });
    const hasUnexpectedMethod = intent.payment_method_types.some((method) => !paymentLinkMethodTypes.includes(method as typeof paymentLinkMethodTypes[number]));
    if (payment.stripePaymentIntentId && ["requires_payment_method", "requires_confirmation"].includes(intent.status) && (!intent.payment_method_types.includes("card") || hasUnexpectedMethod)) {
      intent = await stripe.paymentIntents.update(intent.id, { payment_method_types: [...paymentLinkMethodTypes] }, options);
    }
    assertPaymentIntent(intent, payment, link, accountId);
    if (intent.livemode !== (config.mode === "live")) throw new Error("payment_environment_mismatch");
    if (!intent.client_secret) throw new Error("missing_client_secret");
    if (!payment.stripePaymentIntentId) payment = await db.orbitPaymentLinkPayment.update({ where: { id: payment.id }, data: { stripePaymentIntentId: intent.id, status: "REQUIRES_PAYMENT", failureCode: null } });
    return { clientSecret: intent.client_secret, publishableKey: getStripePublishableKey(), paymentPublicId: payment.publicId, connectedAccountId: accountId };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const mapped = safeStripeFailure(error);
    await db.orbitPaymentLinkPayment.updateMany({ where: { id: payment.id, status: { not: "SUCCEEDED" } }, data: { failureCode: mapped.code } }).catch(() => undefined);
    log.error({ paymentLinkId: link.id, paymentId: payment.id, errorCode: mapped.code }, "Payment Link checkout preparation failed");
    throw mapped.error;
  }
}

export async function getOrbitPaymentLinkPaymentStatus(publicId: string, publicPaymentId: string) {
  if (!publicIdPattern.test(publicId) || !paymentIdPattern.test(publicPaymentId)) throw new HttpError(404, "Payment not found");
  const payment = await getDatabase().orbitPaymentLinkPayment.findFirst({
    where: { publicId: publicPaymentId, paymentLink: { publicId } },
    select: { publicId: true, status: true, customerEmail: true, updatedAt: true },
  });
  if (!payment) throw new HttpError(404, "Payment not found");
  return payment;
}
