export type StripeDisplayStatus = "NOT_CONNECTED" | "ONBOARDING" | "ACTION_REQUIRED" | "IN_REVIEW" | "RESTRICTED" | "ENABLED" | "UNKNOWN";

export type SafeStripeRequirement = {
  key: string;
  label: string;
  status: "currently_due" | "eventually_due" | "past_due" | "pending_verification" | "unknown";
  awaitingActionFrom?: "user" | "stripe";
  errorCodes?: string[];
};

export type NormalizedStripeState = {
  accountId: string;
  livemode: boolean;
  displayStatus: StripeDisplayStatus;
  cardPaymentsStatus?: string;
  payoutsStatus?: string;
  requirementsCurrentlyDue: SafeStripeRequirement[];
  requirementsEventuallyDue: SafeStripeRequirement[];
  requirementsPastDue: SafeStripeRequirement[];
  requirementsPendingVerification: SafeStripeRequirement[];
  futureRequirements: SafeStripeRequirement[];
  statusDetails: Array<{ capability: string; code: string; resolution?: string }>;
  disabledReason?: string;
  safeRawState: Record<string, unknown>;
};

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string | undefined => typeof value === "string" && value.length ? value : undefined;
const bool = (value: unknown): boolean | undefined => typeof value === "boolean" ? value : undefined;
const unique = <T extends { key: string }>(items: T[]) => [...new Map(items.map((item) => [item.key, item])).values()];

export function stripeRequirementLabel(key: string) {
  const lower = key.toLowerCase();
  if (lower.includes("external_account") || lower.includes("bank_account") || lower.includes("stripe_balance")) return "Bank account";
  if (lower.includes("representative") || lower.includes("person") || lower.includes("individual")) return "Business representative";
  if (lower.includes("owner")) return "Beneficial ownership";
  if (lower.includes("director") || lower.includes("executive")) return "Business leadership";
  if (lower.includes("document") || lower.includes("verification")) return lower.includes("business") || lower.includes("company") ? "Business verification" : "Identity verification";
  if (lower.includes("tax")) return "Tax information";
  if (lower.includes("business_profile") || lower.includes("product_description")) return lower.includes("url") ? "Business website" : "Business profile";
  if (lower.includes("address")) return "Business address";
  if (lower.includes("tos") || lower.includes("terms")) return "Stripe terms acceptance";
  const finalPart = key.split(/[.[\]]+/).filter(Boolean).at(-1) ?? key;
  return finalPart.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function safeRequirement(key: string, status: SafeStripeRequirement["status"], awaitingActionFrom?: "user" | "stripe", errorCodes?: string[]): SafeStripeRequirement {
  return { key, label: stripeRequirementLabel(key), status, ...(awaitingActionFrom ? { awaitingActionFrom } : {}), ...(errorCodes?.length ? { errorCodes } : {}) };
}

function capabilityDetails(capability: string, value: unknown) {
  return list(record(value).status_details).map((item) => {
    const detail = record(item);
    return { capability, code: text(detail.code) ?? "unknown", ...(text(detail.resolution) ? { resolution: text(detail.resolution) } : {}) };
  });
}

function deriveDisplayStatus(input: {
  onboardingStarted: boolean;
  cardStatus?: string;
  payoutsStatus?: string;
  current: SafeStripeRequirement[];
  past: SafeStripeRequirement[];
  pending: SafeStripeRequirement[];
  disabledReason?: string;
}) : StripeDisplayStatus {
  const restrictedCapability = [input.cardStatus, input.payoutsStatus].some((status) => status === "restricted" || status === "inactive");
  if (input.disabledReason || input.past.length || restrictedCapability) return "RESTRICTED";
  if (input.current.length) return input.onboardingStarted ? "ACTION_REQUIRED" : "ONBOARDING";
  if (input.pending.length || input.cardStatus === "pending" || input.payoutsStatus === "pending") return "IN_REVIEW";
  if (input.cardStatus === "active" && (!input.payoutsStatus || input.payoutsStatus === "active")) return "ENABLED";
  if (!input.onboardingStarted && input.cardStatus) return "ONBOARDING";
  return "UNKNOWN";
}

export function normalizeV2Account(accountValue: unknown, onboardingStarted = false): NormalizedStripeState {
  const account = record(accountValue);
  const requirements = record(account.requirements);
  const entries = list(requirements.entries).map(record);
  const future = list(record(account.future_requirements).entries).map(record);
  const toRequirement = (entry: JsonRecord, fallback: SafeStripeRequirement["status"]): SafeStripeRequirement => {
    const deadline = text(record(entry.minimum_deadline).status);
    const awaiting = text(entry.awaiting_action_from);
    const key = text(entry.description) ?? text(record(entry.reference).resource) ?? "account_requirement";
    const status = (awaiting === "stripe" ? "pending_verification" : deadline ?? fallback) as SafeStripeRequirement["status"];
    const errorCodes = list(entry.errors).map((error) => text(record(error).code)).filter((code): code is string => Boolean(code));
    return safeRequirement(key, status, awaiting === "stripe" || awaiting === "user" ? awaiting : undefined, errorCodes);
  };
  const normalized = entries.map((entry) => toRequirement(entry, "unknown"));
  const currentlyDue = unique(normalized.filter((item) => item.status === "currently_due" && item.awaitingActionFrom !== "stripe"));
  const eventuallyDue = unique(normalized.filter((item) => item.status === "eventually_due" && item.awaitingActionFrom !== "stripe"));
  const pastDue = unique(normalized.filter((item) => item.status === "past_due"));
  const pending = unique(normalized.filter((item) => item.awaitingActionFrom === "stripe" || item.status === "pending_verification"));
  const futureRequirements = unique(future.map((entry) => toRequirement(entry, "eventually_due")));
  const merchant = record(record(account.configuration).merchant);
  const capabilities = record(merchant.capabilities);
  const card = record(capabilities.card_payments);
  const payout = record(record(capabilities.stripe_balance).payouts);
  const cardStatus = text(card.status);
  const payoutsStatus = text(payout.status);
  const statusDetails = [...capabilityDetails("card_payments", card), ...capabilityDetails("stripe_balance.payouts", payout)];
  const disabledReason = bool(account.closed) ? "account_closed" : statusDetails.find((detail) => detail.code !== "determining_status")?.code;
  const displayStatus = deriveDisplayStatus({ onboardingStarted, cardStatus, payoutsStatus, current: currentlyDue, past: pastDue, pending, disabledReason });
  const accountId = text(account.id) ?? "";
  const livemode = bool(account.livemode) ?? false;
  return {
    accountId, livemode, displayStatus, cardPaymentsStatus: cardStatus, payoutsStatus,
    requirementsCurrentlyDue: currentlyDue, requirementsEventuallyDue: eventuallyDue,
    requirementsPastDue: pastDue, requirementsPendingVerification: pending, futureRequirements,
    statusDetails, disabledReason,
    safeRawState: { object: "v2.core.account", id: accountId, livemode, closed: bool(account.closed) ?? false, appliedConfigurations: list(account.applied_configurations), requirementsSummary: record(requirements.summary), futureRequirementsSummary: record(record(account.future_requirements).summary), cardPaymentsStatus: cardStatus ?? null, payoutsStatus: payoutsStatus ?? null },
  };
}

export function normalizeV1Account(accountValue: unknown, onboardingStarted = false): NormalizedStripeState {
  const account = record(accountValue);
  const requirements = record(account.requirements);
  const future = record(account.future_requirements);
  const fromKeys = (value: unknown, status: SafeStripeRequirement["status"]) => unique(list(value).filter((item): item is string => typeof item === "string").map((key) => safeRequirement(key, status, status === "pending_verification" ? "stripe" : "user")));
  const currentlyDue = fromKeys(requirements.currently_due, "currently_due");
  const eventuallyDue = fromKeys(requirements.eventually_due, "eventually_due");
  const pastDue = fromKeys(requirements.past_due, "past_due");
  const pending = fromKeys(requirements.pending_verification, "pending_verification");
  const futureRequirements = unique([
    ...fromKeys(future.currently_due, "currently_due"),
    ...fromKeys(future.eventually_due, "eventually_due"),
    ...fromKeys(future.past_due, "past_due"),
    ...fromKeys(future.pending_verification, "pending_verification"),
  ]);
  const capabilities = record(account.capabilities);
  const cardStatus = text(capabilities.card_payments) ?? (bool(account.charges_enabled) ? "active" : undefined);
  const payoutsStatus = bool(account.payouts_enabled) === undefined ? text(capabilities.transfers) : bool(account.payouts_enabled) ? "active" : "pending";
  const disabledReason = text(requirements.disabled_reason);
  const statusDetails = disabledReason ? [{ capability: "account", code: disabledReason }] : [];
  const displayStatus = deriveDisplayStatus({ onboardingStarted, cardStatus, payoutsStatus, current: currentlyDue, past: pastDue, pending, disabledReason });
  const accountId = text(account.id) ?? "";
  const livemode = bool(account.livemode) ?? false;
  return {
    accountId, livemode, displayStatus, cardPaymentsStatus: cardStatus, payoutsStatus,
    requirementsCurrentlyDue: currentlyDue, requirementsEventuallyDue: eventuallyDue,
    requirementsPastDue: pastDue, requirementsPendingVerification: pending, futureRequirements,
    statusDetails, disabledReason,
    safeRawState: { object: "account", id: accountId, livemode, chargesEnabled: bool(account.charges_enabled) ?? false, payoutsEnabled: bool(account.payouts_enabled) ?? false, detailsSubmitted: bool(account.details_submitted) ?? false, cardPaymentsStatus: cardStatus ?? null, payoutsStatus: payoutsStatus ?? null },
  };
}
