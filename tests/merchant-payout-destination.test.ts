import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { payoutDestinationSummary } from "../src/merchant-portal/data";

describe("merchant payout destination", () => {
  it("exposes only safe bank destination details", () => {
    const summary = payoutDestinationSummary({
      object: "bank_account",
      bank_name: "WELLS FARGO",
      last4: "6789",
      currency: "usd",
      country: "US",
      status: "verified",
      default_for_currency: true,
    } as Stripe.ExternalAccount);

    expect(summary).toEqual({
      type: "bank_account",
      name: "WELLS FARGO",
      last4: "6789",
      currency: "USD",
      country: "US",
      status: "verified",
      defaultForCurrency: true,
      expires: null,
    });
    expect(summary).not.toHaveProperty("routing_number");
  });

  it("shows card brand, last four digits and expiration", () => {
    const summary = payoutDestinationSummary({
      object: "card",
      brand: "Visa",
      last4: "4242",
      currency: "usd",
      country: "US",
      exp_month: 8,
      exp_year: 2029,
      default_for_currency: true,
    } as Stripe.ExternalAccount);

    expect(summary).toMatchObject({ type: "card", name: "Visa", last4: "4242", expires: "08/29" });
  });
});
