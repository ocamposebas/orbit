import { describe, expect, it } from "vitest";
import { stripeFinancialIssue } from "@/merchant-portal/data";
import { stripeFinancialStatusMessage } from "@/merchant-portal/financial-status";

describe("Merchant Portal Stripe financial status", () => {
  it("classifies credential and permission failures without exposing Stripe details", () => {
    expect(stripeFinancialIssue({ type: "StripeAuthenticationError", statusCode: 401 })).toBe("authentication");
    expect(stripeFinancialIssue({ type: "StripePermissionError", statusCode: 403 })).toBe("permission");
    expect(stripeFinancialIssue({ code: "resource_missing", message: "No such account" })).toBe("account_unavailable");
    expect(stripeFinancialIssue({ type: "StripeRateLimitError", statusCode: 429 })).toBe("rate_limited");
  });

  it("explains partial availability instead of hiding a valid balance", () => {
    expect(stripeFinancialStatusMessage({
      balanceAvailable: true,
      payoutsAvailable: false,
      balanceIssue: null,
      payoutsIssue: "permission",
      administrator: true,
    })).toContain("Live balance is available, but transfer history is unavailable");
  });

  it("gives administrators a concrete restricted-key correction", () => {
    expect(stripeFinancialStatusMessage({
      balanceAvailable: false,
      payoutsAvailable: false,
      balanceIssue: "permission",
      payoutsIssue: "permission",
      administrator: true,
    })).toContain("Payouts write access");
  });

  it("keeps infrastructure details out of the customer message", () => {
    const message = stripeFinancialStatusMessage({
      balanceAvailable: false,
      payoutsAvailable: false,
      balanceIssue: "authentication",
      payoutsIssue: "authentication",
      administrator: false,
    });
    expect(message).toContain("Verified payments remain visible");
    expect(message).not.toContain("STRIPE_SECRET_KEY");
  });
});
