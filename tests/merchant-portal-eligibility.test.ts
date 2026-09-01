import { describe, expect, it } from "vitest";
import { portalActivationEligibility } from "@/merchant-portal/eligibility";

const readyMerchant = {
  agreementStatus: "SIGNED_LOCKED",
  stripeDisplayStatus: "ENABLED",
  cardPaymentsStatus: "active",
  payoutsStatus: "active",
};

describe("merchant portal activation eligibility", () => {
  it("allows activation only when the application and both Stripe capabilities are complete", () => {
    const result = portalActivationEligibility(readyMerchant);

    expect(result.eligible).toBe(true);
    expect(result.requirements.every((requirement) => requirement.complete)).toBe(true);
  });

  it.each([
    ["agreementStatus", "INVITED", "application"],
    ["stripeDisplayStatus", "RESTRICTED", "connect"],
    ["cardPaymentsStatus", "inactive", "payments"],
    ["payoutsStatus", "pending", "payouts"],
  ] as const)("blocks activation when %s is incomplete", (field, value, requirementKey) => {
    const result = portalActivationEligibility({ ...readyMerchant, [field]: value });

    expect(result.eligible).toBe(false);
    expect(result.requirements.find((requirement) => requirement.key === requirementKey)?.complete).toBe(false);
  });

  it("accepts Stripe capability statuses without case sensitivity", () => {
    expect(portalActivationEligibility({ ...readyMerchant, cardPaymentsStatus: "ACTIVE", payoutsStatus: "Active" }).eligible).toBe(true);
  });
});
