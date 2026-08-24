import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class StripePaymentIntentParameterError extends Error {
    readonly status = 422;

    constructor(
      readonly stripeCode: string,
      readonly stripeParam: string,
      readonly stripeMessage: string,
    ) {
      super("Stripe rejected the PaymentIntent parameters");
    }
  }

  return {
    checkout: vi.fn(),
    rateLimit: vi.fn(),
    StripePaymentIntentParameterError,
  };
});

vi.mock("@/payments/service", () => ({
  createCustomerCheckout: mocks.checkout,
  StripePaymentIntentParameterError: mocks.StripePaymentIntentParameterError,
}));
vi.mock("@/sentinel/rate-limit", () => ({ enforceRateLimit: mocks.rateLimit }));
vi.mock("@/sentinel/http", () => ({
  apiError: (error: { status?: number; message?: string }) => Response.json(
    { error: error.message ?? "Unexpected server error" },
    { status: error.status ?? 500 },
  ),
}));

describe("customer payment checkout route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValue(undefined);
  });

  it("returns only sanitized Stripe parameter diagnostics to the trusted Relay caller", async () => {
    mocks.checkout.mockRejectedValueOnce(new mocks.StripePaymentIntentParameterError(
      "parameter_unknown",
      "automatic_payment_methods.enabled",
      "This parameter is not supported for the connected account.",
    ));

    const { POST } = await import("@/app/api/payments/checkout/route");
    const response = await POST(new Request("https://orbit.example/api/payments/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ checkoutToken: "x".repeat(80) }),
    }) as never);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "Stripe rejected the PaymentIntent parameters",
      code: "parameter_unknown",
      message: "This parameter is not supported for the connected account. (parameter: automatic_payment_methods.enabled)",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
