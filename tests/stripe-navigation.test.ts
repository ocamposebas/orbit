import { describe, expect, it } from "vitest";
import { safeLoginContinuation } from "@/sentinel/auth/redirects";
import { canonicalOrbitOrigin, orbitRequestOrigin, stripeOnboardingUrls } from "@/stripe/onboarding-navigation";

const merchantId = "cm12345678901234567890123";

describe("Stripe onboarding navigation", () => {
  it("builds canonical HTTPS return and refresh URLs from APP_URL", () => {
    expect(stripeOnboardingUrls(merchantId, "https://orbit.example,https://alternate.example")).toEqual({
      returnUrl: `https://orbit.example/merchants/${merchantId}/integrations/stripe/return`,
      refreshUrl: `https://orbit.example/merchants/${merchantId}/integrations/stripe/refresh`,
    });
  });

  it("uses an allowed alternate origin for request-local Stripe callbacks", () => {
    const request = new Request(`https://alternate.example/api/sentinel/merchants/${merchantId}/stripe/onboarding`, {
      method: "POST",
      headers: { origin: "https://alternate.example" },
    });
    const origin = orbitRequestOrigin(request, "https://orbit.example,https://alternate.example");
    expect(origin).toBe("https://alternate.example");
    expect(stripeOnboardingUrls(merchantId, origin)).toEqual({
      returnUrl: `https://alternate.example/merchants/${merchantId}/integrations/stripe/return`,
      refreshUrl: `https://alternate.example/merchants/${merchantId}/integrations/stripe/refresh`,
    });
  });

  it.each([
    "http://orbit.example",
    "https://user:password@orbit.example",
    "https://orbit.example/not-an-origin",
    "https://orbit.example/?next=https://evil.example",
  ])("rejects non-canonical APP_URL %s", (appUrl) => {
    expect(() => canonicalOrbitOrigin(appUrl)).toThrow("APP_URL must be the canonical ORBIT HTTPS origin");
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "/sentinel\\evil.example",
    "/not-sentinel?next=/sentinel",
    "/merchants/not-a-cuid/integrations/stripe/refresh",
  ])("rejects open or unapproved login continuation %s", (attempt) => {
    expect(safeLoginContinuation(attempt)).toBe("/sentinel");
  });

  it("allows only the generated merchant dashboard and Stripe refresh continuations", () => {
    expect(safeLoginContinuation(`/sentinel/merchant/${merchantId}?stripeReturn=login#stripe-connect`)).toBe(`/sentinel/merchant/${merchantId}?stripeReturn=login#stripe-connect`);
    expect(safeLoginContinuation("/dashboard/payments?status=succeeded")).toBe("/dashboard/payments?status=succeeded");
    expect(safeLoginContinuation(`/merchants/${merchantId}/integrations/stripe/refresh`)).toBe(`/merchants/${merchantId}/integrations/stripe/refresh`);
  });
});
