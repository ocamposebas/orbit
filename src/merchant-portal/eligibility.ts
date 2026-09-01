export type PortalEligibilityInput = {
  agreementStatus?: string | null;
  stripeDisplayStatus?: string | null;
  cardPaymentsStatus?: string | null;
  payoutsStatus?: string | null;
};

export function portalActivationEligibility(input: PortalEligibilityInput) {
  const requirements = [
    { key: "application", label: "Application and signed agreement completed", complete: input.agreementStatus === "SIGNED_LOCKED" },
    { key: "connect", label: "ORBIT Payment verification enabled", complete: input.stripeDisplayStatus === "ENABLED" },
    { key: "payments", label: "Card payments capability active", complete: input.cardPaymentsStatus?.toLowerCase() === "active" },
    { key: "payouts", label: "Transfers capability active", complete: input.payoutsStatus?.toLowerCase() === "active" },
  ];
  return { eligible: requirements.every((requirement) => requirement.complete), requirements };
}
