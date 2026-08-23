import type Stripe from "stripe";
import { getDatabase } from "@/sentinel/db";
import { getServerEnv } from "@/sentinel/config";
import { HttpError } from "@/sentinel/http";
import { childLogger } from "@/sentinel/logger";
import { assertStripeEnvironment, getStripeClient, getStripeConfiguration, stripeApiUnavailable, stripeEnvironment, type StripeAccountApi } from "./client";
import { isStripeConnectCountry, type StripeConnectCountryCode } from "./countries";
import { normalizeV1Account, normalizeV2Account, type NormalizedStripeState } from "./normalize";

const stripeLogger = childLogger({ component: "stripe-connect" });
const ownerAdminRoles = new Set(["OWNER", "ADMIN"]);

export function canManageStripeConnect(role: string) { return ownerAdminRoles.has(role); }
export function stripeConnectIdempotencyKey(merchantId: string, api: StripeAccountApi, mode: "test" | "live") { return `orbit-connect-${api}-${mode}-${merchantId}`; }

export function requireStripeLegalCountry(value: string | null | undefined): StripeConnectCountryCode {
  if (!value) throw new HttpError(422, "Set the merchant's legal business country before connecting Stripe.");
  if (!isStripeConnectCountry(value)) throw new HttpError(422, "The merchant's legal business country must be a supported uppercase ISO 3166-1 alpha-2 code.");
  return value;
}

type StripeAccountCreationInput = {
  merchantId: string;
  organizationId: string;
  businessName: string;
  businessDescription: string;
  website?: string;
  legalCountry: StripeConnectCountryCode;
  api: StripeAccountApi;
};

export function buildStripeV2AccountCreateParams(input: Omit<StripeAccountCreationInput, "api">): Stripe.V2.Core.AccountCreateParams {
  return {
    display_name: input.businessName,
    identity: { country: input.legalCountry },
    metadata: { orbit_merchant_id: input.merchantId, orbit_organization_id: input.organizationId },
    dashboard: "full",
    configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
    defaults: {
      responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
      profile: { product_description: input.businessDescription.slice(0, 500), ...(input.website ? { business_url: input.website } : {}) },
    },
    include: ["configuration.merchant", "defaults", "future_requirements", "requirements"],
  };
}

function safeErrorCode(error: unknown) {
  const value = error as { type?: string; code?: string; statusCode?: number };
  return (value.code ?? value.type ?? (value.statusCode ? `http_${value.statusCode}` : "unexpected_error")).slice(0, 120);
}

function jsonValue(value: unknown) { return JSON.parse(JSON.stringify(value)) as object; }

async function audit(input: { organizationId: string; merchantId: string; actorId?: string; action: string; targetId: string; metadata?: Record<string, unknown> }) {
  await getDatabase().auditLog.create({ data: {
    organizationId: input.organizationId,
    merchantId: input.merchantId,
    actorId: input.actorId,
    action: input.action,
    targetType: "StripeConnectIntegration",
    targetId: input.targetId,
    metadata: jsonValue(input.metadata ?? {}),
  } });
}

export async function auditStripeConnectError(merchantId: string, actorId: string | undefined, operation: string, error: unknown) {
  const merchant = await getDatabase().merchant.findUnique({ where: { id: merchantId }, select: { id: true, organizationId: true } });
  if (!merchant) return;
  const errorCode = safeErrorCode(error);
  stripeLogger.error({ merchantId, operation, errorCode }, "Stripe Connect operation failed");
  await audit({ organizationId: merchant.organizationId, merchantId, actorId, action: "STRIPE_CONNECT_ERROR", targetId: merchantId, metadata: { operation, errorCode } }).catch(() => undefined);
}

function accountId(account: unknown) {
  const id = typeof account === "object" && account !== null && "id" in account ? (account as { id?: unknown }).id : undefined;
  if (typeof id !== "string" || !id.startsWith("acct_")) throw new HttpError(502, "Stripe did not return a valid connected account identifier");
  return id;
}

function mapStripeFailure(error: unknown, api: StripeAccountApi): never {
  if (stripeApiUnavailable(error, api)) {
    throw new HttpError(503, "Stripe Accounts v2 is not enabled for this platform. Enable Accounts v2 in Stripe, or explicitly set STRIPE_CONNECT_ACCOUNT_API=v1 and configure v1 account.updated events.");
  }
  const value = error as { type?: string; statusCode?: number };
  if (value.type === "StripeAuthenticationError") throw new HttpError(503, "Stripe rejected the configured server credential");
  if (value.type === "StripePermissionError") throw new HttpError(503, "The Stripe credential does not have the required Connect account permission");
  if (value.type === "StripeRateLimitError" || value.statusCode === 429) throw new HttpError(429, "Stripe rate limited this request. Try again shortly.");
  throw new HttpError(502, "Stripe Connect is temporarily unavailable");
}

async function createAccountOnStripe(input: StripeAccountCreationInput) {
  const stripe = getStripeClient();
  const idempotencyKey = stripeConnectIdempotencyKey(input.merchantId, input.api, getStripeConfiguration().mode);
  try {
    if (input.api === "v2") {
      return await stripe.v2.core.accounts.create(buildStripeV2AccountCreateParams(input), { idempotencyKey });
    }
    return await stripe.accounts.create({
      country: input.legalCountry,
      business_profile: { name: input.businessName.slice(0, 120), product_description: input.businessDescription.slice(0, 500), ...(input.website ? { url: input.website } : {}) },
      capabilities: { card_payments: { requested: true } },
      controller: { fees: { payer: "stripe" }, losses: { payments: "stripe" }, stripe_dashboard: { type: "full" } },
      metadata: { orbit_merchant_id: input.merchantId, orbit_organization_id: input.organizationId },
    }, { idempotencyKey });
  } catch (error) { return mapStripeFailure(error, input.api); }
}

export async function connectStripeAccount(merchantId: string, actorId: string) {
  const db = getDatabase();
  const config = getStripeConfiguration();
  if (!config.configured) throw new HttpError(503, "Stripe Connect is not configured");
  const merchant = await db.merchant.findUnique({ where: { id: merchantId }, include: { sites: { where: { active: true }, take: 1 }, stripeConnect: true } });
  if (!merchant) throw new HttpError(404, "Merchant not found");
  if (merchant.stripeConnect) {
    if (merchant.stripeConnect.stripeEnvironment !== stripeEnvironment(config.mode)) throw new HttpError(409, `This merchant is connected to Stripe ${merchant.stripeConnect.stripeEnvironment.toLowerCase()}, but ORBIT is configured for ${config.mode}`);
    return syncStripeConnectAccount(merchantId, { actorId });
  }
  const legalCountry = requireStripeLegalCountry(merchant.legalCountry);
  const account = await createAccountOnStripe({
    merchantId,
    organizationId: merchant.organizationId,
    businessName: merchant.businessName,
    businessDescription: merchant.businessDescription,
    website: merchant.sites[0]?.normalizedUrl,
    legalCountry,
    api: config.accountApi,
  });
  const stripeAccountId = accountId(account);
  assertStripeEnvironment(Boolean((account as { livemode?: boolean }).livemode), config.mode);
  let integration;
  try {
    integration = await db.stripeConnectIntegration.create({ data: {
      merchantId,
      stripeAccountId,
      stripeEnvironment: stripeEnvironment(config.mode),
      accountApiVersion: config.accountApi === "v2" ? "V2" : "V1",
    } });
  } catch (error) {
    const existing = await db.stripeConnectIntegration.findUnique({ where: { merchantId } });
    if (!existing || existing.stripeAccountId !== stripeAccountId) throw error;
    integration = existing;
  }
  await audit({ organizationId: merchant.organizationId, merchantId, actorId, action: "STRIPE_CONNECT_ACCOUNT_CREATED", targetId: integration.id, metadata: { stripeAccountId, environment: config.mode, accountApi: config.accountApi } });
  return syncStripeConnectAccount(merchantId, { actorId, suppressStandardAudit: true });
}

async function retrieveAccount(stripeAccountId: string, api: StripeAccountApi) {
  const stripe = getStripeClient();
  try {
    if (api === "v2") return await stripe.v2.core.accounts.retrieve(stripeAccountId, { include: ["configuration.merchant", "defaults", "future_requirements", "requirements"] });
    return await stripe.accounts.retrieve(stripeAccountId);
  } catch (error) { return mapStripeFailure(error, api); }
}

export async function syncStripeConnectAccount(merchantId: string, options: { actorId?: string; auditAction?: "STRIPE_STATUS_SYNCED" | "STRIPE_REQUIREMENTS_UPDATED"; eventId?: string; suppressStandardAudit?: boolean } = {}) {
  const db = getDatabase();
  const config = getStripeConfiguration();
  if (!config.configured) throw new HttpError(503, "Stripe Connect is not configured");
  const integration = await db.stripeConnectIntegration.findUnique({ where: { merchantId }, include: { merchant: { select: { organizationId: true } } } });
  if (!integration) throw new HttpError(409, "This merchant does not have a Stripe connected account");
  if (integration.stripeEnvironment !== stripeEnvironment(config.mode)) throw new HttpError(409, `Stripe environment mismatch: merchant is ${integration.stripeEnvironment.toLowerCase()} and ORBIT is ${config.mode}`);
  const api = integration.accountApiVersion === "V2" ? "v2" : "v1";
  const account = await retrieveAccount(integration.stripeAccountId, api);
  const livemode = Boolean((account as { livemode?: boolean }).livemode);
  assertStripeEnvironment(livemode, config.mode);
  if (accountId(account) !== integration.stripeAccountId) throw new HttpError(409, "Stripe returned an unexpected connected account");
  const normalized = api === "v2" ? normalizeV2Account(account, Boolean(integration.onboardingStartedAt)) : normalizeV1Account(account, Boolean(integration.onboardingStartedAt));
  const syncedAt = new Date();
  const onboardingComplete = normalized.requirementsCurrentlyDue.length === 0 && normalized.requirementsPastDue.length === 0 && ["IN_REVIEW", "ENABLED"].includes(normalized.displayStatus);
  const updated = await db.stripeConnectIntegration.update({ where: { id: integration.id }, data: {
    displayStatus: normalized.displayStatus,
    cardPaymentsStatus: normalized.cardPaymentsStatus,
    payoutsStatus: normalized.payoutsStatus,
    requirementsCurrentlyDue: jsonValue(normalized.requirementsCurrentlyDue),
    requirementsEventuallyDue: jsonValue(normalized.requirementsEventuallyDue),
    requirementsPastDue: jsonValue(normalized.requirementsPastDue),
    requirementsPendingVerification: jsonValue(normalized.requirementsPendingVerification),
    futureRequirements: jsonValue(normalized.futureRequirements),
    statusDetails: jsonValue(normalized.statusDetails),
    disabledReason: normalized.disabledReason,
    rawStripeState: jsonValue(normalized.safeRawState),
    lastSyncedAt: syncedAt,
    ...(onboardingComplete && !integration.onboardingCompletedAt ? { onboardingCompletedAt: syncedAt } : {}),
  } });
  const auditAction = options.auditAction ?? "STRIPE_STATUS_SYNCED";
  if (!options.suppressStandardAudit) await audit({ organizationId: integration.merchant.organizationId, merchantId, actorId: options.actorId, action: auditAction, targetId: integration.id, metadata: { displayStatus: normalized.displayStatus, previousStatus: integration.displayStatus, eventId: options.eventId, currentlyDue: normalized.requirementsCurrentlyDue.length, pendingVerification: normalized.requirementsPendingVerification.length, pastDue: normalized.requirementsPastDue.length } });
  if (integration.displayStatus !== normalized.displayStatus) {
    const transitionAction = normalized.displayStatus === "ENABLED" ? "STRIPE_VERIFICATION_ENABLED" : ["ACTION_REQUIRED", "RESTRICTED"].includes(normalized.displayStatus) ? "STRIPE_ACTION_REQUIRED" : undefined;
    if (transitionAction) await audit({ organizationId: integration.merchant.organizationId, merchantId, actorId: options.actorId, action: transitionAction, targetId: integration.id, metadata: { displayStatus: normalized.displayStatus, previousStatus: integration.displayStatus } });
  }
  return safeStripeIntegration(updated);
}

export async function createStripeOnboardingLink(merchantId: string, actorId?: string) {
  const db = getDatabase();
  const config = getStripeConfiguration();
  if (!config.configured) throw new HttpError(503, "Stripe Connect is not configured");
  const integration = await db.stripeConnectIntegration.findUnique({ where: { merchantId }, include: { merchant: { select: { organizationId: true } } } });
  if (!integration) throw new HttpError(409, "Connect Stripe before starting verification");
  if (integration.stripeEnvironment !== stripeEnvironment(config.mode)) throw new HttpError(409, "Stripe environment mismatch");
  const appUrl = getServerEnvUrl();
  const returnUrl = `${appUrl}/merchants/${encodeURIComponent(merchantId)}/integrations/stripe/return`;
  const refreshUrl = `${appUrl}/merchants/${encodeURIComponent(merchantId)}/integrations/stripe/refresh`;
  const stripe = getStripeClient();
  const api = integration.accountApiVersion === "V2" ? "v2" : "v1";
  try {
    const link = api === "v2"
      ? await stripe.v2.core.accountLinks.create({ account: integration.stripeAccountId, use_case: { type: "account_onboarding", account_onboarding: { configurations: ["merchant"], refresh_url: refreshUrl, return_url: returnUrl, collection_options: { fields: "eventually_due", future_requirements: "include" } } } })
      : await stripe.accountLinks.create({ account: integration.stripeAccountId, type: "account_onboarding", refresh_url: refreshUrl, return_url: returnUrl, collection_options: { fields: "eventually_due", future_requirements: "include" } });
    const startedAt = integration.onboardingStartedAt ?? new Date();
    await db.stripeConnectIntegration.update({ where: { id: integration.id }, data: { onboardingStartedAt: startedAt } });
    await audit({ organizationId: integration.merchant.organizationId, merchantId, actorId, action: "STRIPE_ONBOARDING_STARTED", targetId: integration.id, metadata: { accountApi: api } });
    return { url: link.url };
  } catch (error) { return mapStripeFailure(error, api); }
}

function getServerEnvUrl() {
  const { APP_URL } = getServerEnv();
  return APP_URL.replace(/\/$/, "");
}

export function safeStripeIntegration<T extends {
  id: string; stripeAccountId: string; stripeEnvironment: string; accountApiVersion: string; displayStatus: string;
  cardPaymentsStatus: string | null; payoutsStatus: string | null; requirementsCurrentlyDue: unknown; requirementsEventuallyDue: unknown;
  requirementsPastDue: unknown; requirementsPendingVerification: unknown; futureRequirements: unknown; statusDetails: unknown; disabledReason: string | null;
  onboardingStartedAt: Date | null; onboardingCompletedAt: Date | null; lastSyncedAt: Date | null; createdAt: Date; updatedAt: Date;
}>(value: T) {
  return {
    id: value.id,
    stripeAccountId: value.stripeAccountId,
    stripeEnvironment: value.stripeEnvironment,
    accountApiVersion: value.accountApiVersion,
    displayStatus: value.displayStatus,
    cardPaymentsStatus: value.cardPaymentsStatus,
    payoutsStatus: value.payoutsStatus,
    requirementsCurrentlyDue: value.requirementsCurrentlyDue,
    requirementsEventuallyDue: value.requirementsEventuallyDue,
    requirementsPastDue: value.requirementsPastDue,
    requirementsPendingVerification: value.requirementsPendingVerification,
    futureRequirements: value.futureRequirements,
    statusDetails: value.statusDetails,
    disabledReason: value.disabledReason,
    onboardingStartedAt: value.onboardingStartedAt,
    onboardingCompletedAt: value.onboardingCompletedAt,
    lastSyncedAt: value.lastSyncedAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export type { NormalizedStripeState };
