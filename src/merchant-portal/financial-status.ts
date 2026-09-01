import type { StripeFinancialIssue } from "./data";

type FinancialStatusInput = {
  balanceAvailable: boolean;
  payoutsAvailable: boolean;
  balanceIssue: StripeFinancialIssue | null;
  payoutsIssue: StripeFinancialIssue | null;
  administrator: boolean;
};

function adminIssueMessage(issue: StripeFinancialIssue | null) {
  if (issue === "not_configured") return "Stripe financial access is not configured in this deployment. Add the live STRIPE_SECRET_KEY and redeploy the web service.";
  if (issue === "environment_mismatch") return "This connected account and ORBIT are using different Stripe environments. Align STRIPE_MODE and the test/live keys, then sync the account.";
  if (issue === "authentication") return "Stripe rejected ORBIT's server credential. Replace STRIPE_SECRET_KEY with a valid key for this Connect platform.";
  if (issue === "permission") return "ORBIT's Stripe credential is missing read access for Balance or Payouts. Use the platform secret key, or enable read permission for both resources on the restricted key.";
  if (issue === "account_unavailable") return "The connected account is not accessible from this Stripe platform. Reconnect it and run Sync Stripe status from Sentinel.";
  if (issue === "rate_limited") return "Stripe temporarily rate-limited financial data. Retry in a moment; verified ORBIT payments remain available.";
  if (issue === "not_connected") return "Stripe is not connected for this brand. Complete Stripe onboarding and sync the account from Sentinel.";
  return "Stripe could not return financial data on this refresh. Retry shortly; if it continues, review the web-service Stripe logs for this brand.";
}

export function stripeFinancialStatusMessage(input: FinancialStatusInput) {
  if (input.balanceAvailable && input.payoutsAvailable) return null;
  if (!input.administrator) {
    if (input.balanceAvailable) return "Your live balance is available, but Stripe has not returned payout history yet. Verified payments remain visible.";
    return "Stripe has not returned live balance or payout data yet. Verified ORBIT payments remain visible while the account is reviewed.";
  }
  const issue = !input.balanceAvailable ? input.balanceIssue : input.payoutsIssue;
  const prefix = input.balanceAvailable
    ? "Live balance is available, but payout history is unavailable. "
    : input.payoutsAvailable
      ? "Payout history is available, but live balance is unavailable. "
      : "";
  return `${prefix}${adminIssueMessage(issue)}`;
}
