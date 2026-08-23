import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  merchantFindUnique: vi.fn(),
  stripeCreate: vi.fn(),
  getStripeClient: vi.fn(),
}));

vi.mock("@/sentinel/db", () => ({
  getDatabase: () => ({ merchant: { findUnique: mocks.merchantFindUnique } }),
}));

vi.mock("@/stripe/client", () => ({
  getStripeConfiguration: () => ({ configured: true, mode: "test", accountApi: "v2" }),
  getStripeClient: mocks.getStripeClient,
  stripeEnvironment: (mode: string) => mode === "live" ? "LIVE" : "TEST",
  assertStripeEnvironment: vi.fn(),
  stripeApiUnavailable: () => false,
}));

describe("Stripe legal country creation guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStripeClient.mockReturnValue({ v2: { core: { accounts: { create: mocks.stripeCreate } } } });
    mocks.merchantFindUnique.mockResolvedValue({
      id: "merchant_1",
      organizationId: "org_1",
      businessName: "Merchant",
      businessDescription: "Merchant product description",
      legalCountry: null,
      sites: [{ normalizedUrl: "https://example.com/" }],
      stripeConnect: null,
    });
  });

  it("does not initialize or call Stripe when legalCountry is missing", async () => {
    const { connectStripeAccount } = await import("@/stripe/service");
    await expect(connectStripeAccount("merchant_1", "user_1")).rejects.toThrow("Set the merchant's legal business country before connecting Stripe.");
    expect(mocks.getStripeClient).not.toHaveBeenCalled();
    expect(mocks.stripeCreate).not.toHaveBeenCalled();
  });

  it.each(["us", "ZZ"])('does not call Stripe when legalCountry is invalid ("%s")', async (legalCountry) => {
    mocks.merchantFindUnique.mockResolvedValueOnce({
      id: "merchant_1",
      organizationId: "org_1",
      businessName: "Merchant",
      businessDescription: "Merchant product description",
      legalCountry,
      sites: [{ normalizedUrl: "https://example.com/" }],
      stripeConnect: null,
    });
    const { connectStripeAccount } = await import("@/stripe/service");
    await expect(connectStripeAccount("merchant_1", "user_1")).rejects.toThrow(/supported uppercase ISO 3166-1 alpha-2/);
    expect(mocks.getStripeClient).not.toHaveBeenCalled();
    expect(mocks.stripeCreate).not.toHaveBeenCalled();
  });
});
