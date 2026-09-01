import type { StripeFinancialIssue } from "./data";

type FinancialStatusInput = {
  balanceAvailable: boolean;
  payoutsAvailable: boolean;
  balanceIssue: StripeFinancialIssue | null;
  payoutsIssue: StripeFinancialIssue | null;
  administrator: boolean;
};

function adminIssueMessage(issue: StripeFinancialIssue | null) {
  if (issue === "not_configured") return "ORBIT Payment financial access is not configured in this deployment. Add the live server credential and redeploy the web service.";
  if (issue === "environment_mismatch") return "This account and ORBIT Payment are using different environments. Align the live configuration, then sync the account.";
  if (issue === "authentication") return "ORBIT Payment rejected the current server credential. Replace it with a valid platform credential.";
  if (issue === "permission") return "ORBIT Payment needs Balance read and Payouts read access. Transfers additionally require Payouts write access.";
  if (issue === "account_unavailable") return "This financial account is not accessible from ORBIT Payment. Reconnect it and run account sync from Sentinel.";
  if (issue === "rate_limited") return "ORBIT Payment temporarily limited financial refreshes. Retry in a moment; verified payments remain available.";
  if (issue === "not_connected") return "ORBIT Payment is not connected for this brand. Complete financial onboarding and sync the account from Sentinel.";
  return "ORBIT Payment could not return financial data on this refresh. Retry shortly; if it continues, review the financial service logs for this brand.";
}

export function stripeFinancialStatusMessage(input: FinancialStatusInput) {
  if (input.balanceAvailable && input.payoutsAvailable) return null;
  if (!input.administrator) {
    if (input.balanceAvailable) return "Your live balance is available, but ORBIT Payment has not returned transfer history yet. Verified payments remain visible.";
    return "ORBIT Payment has not returned live balance or transfer data yet. Verified payments remain visible while the account is reviewed.";
  }
  const issue = !input.balanceAvailable ? input.balanceIssue : input.payoutsIssue;
  const prefix = input.balanceAvailable
    ? "Live balance is available, but transfer history is unavailable. "
    : input.payoutsAvailable
      ? "Transfer history is available, but live balance is unavailable. "
      : "";
  return `${prefix}${adminIssueMessage(issue)}`;
}
