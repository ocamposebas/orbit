import { describe, expect, it } from "vitest";
import { HttpError } from "@/sentinel/http";
import { inspectStripeKey, inspectStripePublishableKey } from "@/stripe/client";
import { normalizeV1Account, normalizeV2Account, stripeRequirementLabel } from "@/stripe/normalize";
import { buildStripeEmbeddedOnboardingSessionParams, buildStripeV2AccountCreateParams, canManageStripeConnect, requireStripeLegalCountry, stripeConnectIdempotencyKey } from "@/stripe/service";

function v2Account(overrides: Record<string, unknown> = {}) {
  return {
    id: "acct_test_orbit",
    object: "v2.core.account",
    livemode: false,
    applied_configurations: ["merchant"],
    requirements: { entries: [], summary: {} },
    future_requirements: { entries: [], summary: {} },
    configuration: { merchant: { capabilities: { card_payments: { status: "pending", status_details: [] }, stripe_balance: { payouts: { status: "pending", status_details: [] } } } } },
    ...overrides,
  };
}

function entry(description: string, status: "currently_due" | "eventually_due" | "past_due", awaiting: "user" | "stripe" = "user") {
  return { description, awaiting_action_from: awaiting, errors: [], impact: {}, minimum_deadline: { status }, requested_reasons: [{ code: "routine_onboarding" }] };
}

describe("Stripe Connect configuration and authorization", () => {
  it("is optional when Stripe is not configured", () => {
    expect(inspectStripeKey(undefined, "test")).toEqual({ configured: false, mode: "test" });
  });

  it("fails clearly when test and live environments are mixed", () => {
    expect(() => inspectStripeKey("sk_test_example", "live")).toThrow(HttpError);
    expect(() => inspectStripeKey("rk_live_example", "test")).toThrow(/does not match/);
    expect(() => inspectStripePublishableKey("pk_live_example", "test")).toThrow(/does not match/);
  });

  it("limits embedded sessions to onboarding without payment-management permissions", () => {
    expect(buildStripeEmbeddedOnboardingSessionParams("acct_orbit")).toEqual({
      account: "acct_orbit",
      components: { account_onboarding: { enabled: true, features: { external_account_collection: true } } },
    });
  });

  it.each(["OWNER", "ADMIN"])("allows %s to manage Stripe", (role) => expect(canManageStripeConnect(role)).toBe(true));
  it.each(["ANALYST", "REVIEWER", "VIEWER", "UNKNOWN"])("forbids %s from managing Stripe", (role) => expect(canManageStripeConnect(role)).toBe(false));

  it("uses one stable account-creation idempotency key per merchant, API, and environment", () => {
    const first = stripeConnectIdempotencyKey("merchant_1", "v2", "test");
    expect(stripeConnectIdempotencyKey("merchant_1", "v2", "test")).toBe(first);
    expect(stripeConnectIdempotencyKey("merchant_2", "v2", "test")).not.toBe(first);
    expect(stripeConnectIdempotencyKey("merchant_1", "v2", "live")).not.toBe(first);
  });

  it.each(["us", "USA", "ZZ", "U1"])('rejects malformed or unsupported legal country "%s"', (country) => {
    expect(() => requireStripeLegalCountry(country)).toThrow(/supported uppercase ISO 3166-1 alpha-2/);
  });

  it.each(["US", "CO"] as const)("sends identity.country = %s without changing the Accounts v2 configuration", (legalCountry) => {
    const payload = buildStripeV2AccountCreateParams({
      merchantId: "merchant_1",
      organizationId: "org_1",
      businessName: "RGVPRIME LLC",
      businessDescription: "Merchant product description",
      website: "https://example.com/",
      legalCountry,
    });
    expect(payload.identity).toEqual({ country: legalCountry });
    expect(payload.configuration).toMatchObject({ merchant: { capabilities: { card_payments: { requested: true } } } });
    expect(payload.dashboard).toBe("full");
    expect(payload.defaults).toMatchObject({
      responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
      profile: { business_url: "https://example.com/", product_description: "Merchant product description" },
    });
    expect(payload.metadata).toEqual({ orbit_merchant_id: "merchant_1", orbit_organization_id: "org_1" });
    expect(payload.include).toEqual(["configuration.merchant", "defaults", "future_requirements", "requirements"]);
  });
});

describe("Accounts v2 verification normalization", () => {
  it("separates currently due, eventually due, future, and pending-verification requirements", () => {
    const normalized = normalizeV2Account(v2Account({
      requirements: { entries: [
        entry("identity.business_details.registered_name", "currently_due"),
        entry("identity.business_details.address", "eventually_due"),
        entry("identity.business_details.documents", "currently_due", "stripe"),
      ] },
      future_requirements: { entries: [entry("identity.business_details.tax_id", "eventually_due")] },
    }), true);
    expect(normalized.requirementsCurrentlyDue.map((item) => item.key)).toEqual(["identity.business_details.registered_name"]);
    expect(normalized.requirementsEventuallyDue.map((item) => item.key)).toEqual(["identity.business_details.address"]);
    expect(normalized.requirementsPendingVerification.map((item) => item.key)).toEqual(["identity.business_details.documents"]);
    expect(normalized.futureRequirements.map((item) => item.key)).toEqual(["identity.business_details.tax_id"]);
    expect(normalized.displayStatus).toBe("ACTION_REQUIRED");
  });

  it("uses ONBOARDING before hosted onboarding has started", () => {
    const normalized = normalizeV2Account(v2Account({ requirements: { entries: [entry("identity.entity_type", "currently_due")] } }));
    expect(normalized.displayStatus).toBe("ONBOARDING");
  });

  it("uses IN_REVIEW while Stripe is responsible for verification", () => {
    const normalized = normalizeV2Account(v2Account({ requirements: { entries: [entry("identity.verification.document", "currently_due", "stripe")] } }), true);
    expect(normalized.displayStatus).toBe("IN_REVIEW");
  });

  it("uses RESTRICTED for past-due requirements", () => {
    const normalized = normalizeV2Account(v2Account({ requirements: { entries: [entry("identity.business_details.tax_id", "past_due")] } }), true);
    expect(normalized.displayStatus).toBe("RESTRICTED");
    expect(normalized.requirementsPastDue).toHaveLength(1);
  });

  it("uses RESTRICTED for a restricted required capability", () => {
    const normalized = normalizeV2Account(v2Account({ configuration: { merchant: { capabilities: { card_payments: { status: "restricted", status_details: [{ code: "restricted_other", resolution: "contact_stripe" }] }, stripe_balance: { payouts: { status: "active", status_details: [] } } } } } }), true);
    expect(normalized.displayStatus).toBe("RESTRICTED");
    expect(normalized.disabledReason).toBe("restricted_other");
  });

  it("uses ENABLED only when requested capabilities are active without blocking requirements", () => {
    const normalized = normalizeV2Account(v2Account({ configuration: { merchant: { capabilities: { card_payments: { status: "active", status_details: [] }, stripe_balance: { payouts: { status: "active", status_details: [] } } } } } }), true);
    expect(normalized.displayStatus).toBe("ENABLED");
  });

  it("uses UNKNOWN when Stripe returns insufficient status information", () => {
    const normalized = normalizeV2Account({ id: "acct_test_orbit", livemode: false, requirements: { entries: [] }, future_requirements: { entries: [] } }, true);
    expect(normalized.displayStatus).toBe("UNKNOWN");
  });
});

describe("Accounts v1 compatibility normalization", () => {
  it("normalizes all v1 requirement buckets without sensitive values", () => {
    const normalized = normalizeV1Account({ id: "acct_v1", livemode: false, charges_enabled: false, payouts_enabled: false, capabilities: { card_payments: "pending" }, requirements: { currently_due: ["company.tax_id"], eventually_due: ["company.owners_provided"], past_due: [], pending_verification: ["company.verification.document"] }, future_requirements: { eventually_due: ["external_account"] } }, true);
    expect(normalized.displayStatus).toBe("ACTION_REQUIRED");
    expect(normalized.requirementsCurrentlyDue[0]).toMatchObject({ key: "company.tax_id", label: "Tax information" });
    expect(normalized.requirementsPendingVerification).toHaveLength(1);
    expect(normalized.futureRequirements).toHaveLength(1);
    expect(JSON.stringify(normalized.safeRawState)).not.toContain("company.tax_id");
  });
});

describe("safe requirement labels", () => {
  it.each([
    ["external_account", "Bank account"],
    ["representative.verification.document", "Business representative"],
    ["company.owners_provided", "Beneficial ownership"],
    ["company.tax_id", "Tax information"],
    ["business_profile.url", "Business website"],
  ])("maps %s to %s", (key, label) => expect(stripeRequirementLabel(key)).toBe(label));
});
