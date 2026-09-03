import { HttpError } from "@/sentinel/http";

const stripeOnboardingAdministratorRoles = new Set(["OWNER", "ADMIN"]);

export function canOpenStripeOnboarding(role: string, merchantEnabled: boolean) {
  return stripeOnboardingAdministratorRoles.has(role) || merchantEnabled;
}

export function requireStripeOnboardingAccess(role: string, merchantEnabled: boolean) {
  if (!canOpenStripeOnboarding(role, merchantEnabled)) {
    throw new HttpError(403, "Stripe verification has not been enabled by an ORBIT administrator");
  }
}
