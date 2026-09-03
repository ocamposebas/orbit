export type StatementEntryType = "PAYMENT" | "REFUND" | "DISPUTE" | "PAYOUT" | "ADJUSTMENT";

export type StatementLedgerEntry = {
  externalId: string;
  type: StatementEntryType;
  processorType: string;
  reportingCategory: string;
  reference?: string | null;
  description?: string | null;
  amountMinor: bigint;
  processingFeeMinor: bigint;
  orbitFeeMinor: bigint;
  netMinor: bigint;
  occurredAt: Date;
};

export type StatementTotals = {
  openingBalanceMinor: bigint;
  grossPaymentsMinor: bigint;
  refundsMinor: bigint;
  disputesMinor: bigint;
  processingFeesMinor: bigint;
  orbitFeesMinor: bigint;
  adjustmentsMinor: bigint;
  netActivityMinor: bigint;
  payoutsMinor: bigint;
  closingBalanceMinor: bigint;
  paymentCount: number;
  refundCount: number;
  disputeCount: number;
};

const ZERO = BigInt(0);
const absolute = (value: bigint) => value < ZERO ? -value : value;

/**
 * All arithmetic is integer minor-unit arithmetic. Adjustments are the exact
 * residual ledger impact after named categories, so unfamiliar processor types
 * remain visible without making the reconciliation inaccurate.
 */
export function calculateStatementTotals(openingBalanceMinor: bigint, entries: StatementLedgerEntry[]): StatementTotals {
  let grossPaymentsMinor = ZERO;
  let refundsMinor = ZERO;
  let disputesMinor = ZERO;
  let processingFeesMinor = ZERO;
  let orbitFeesMinor = ZERO;
  let payoutsMinor = ZERO;
  let netActivityMinor = ZERO;
  let paymentCount = 0;
  let refundCount = 0;
  let disputeCount = 0;

  for (const entry of entries) {
    if (entry.type === "PAYOUT") {
      payoutsMinor += absolute(entry.netMinor || entry.amountMinor);
      continue;
    }
    netActivityMinor += entry.netMinor;
    if (entry.type === "PAYMENT") {
      grossPaymentsMinor += entry.amountMinor > ZERO ? entry.amountMinor : ZERO;
      processingFeesMinor += entry.processingFeeMinor;
      orbitFeesMinor += entry.orbitFeeMinor;
      paymentCount += 1;
    } else if (entry.type === "REFUND") {
      refundsMinor += absolute(entry.amountMinor);
      refundCount += 1;
    } else if (entry.type === "DISPUTE") {
      disputesMinor += absolute(entry.amountMinor);
      disputeCount += 1;
    }
  }

  const categorizedNet = grossPaymentsMinor - refundsMinor - disputesMinor - processingFeesMinor - orbitFeesMinor;
  const adjustmentsMinor = netActivityMinor - categorizedNet;
  const closingBalanceMinor = openingBalanceMinor + netActivityMinor - payoutsMinor;
  return { openingBalanceMinor, grossPaymentsMinor, refundsMinor, disputesMinor, processingFeesMinor, orbitFeesMinor, adjustmentsMinor, netActivityMinor, payoutsMinor, closingBalanceMinor, paymentCount, refundCount, disputeCount };
}

export function reconciliationDelta(totals: StatementTotals) {
  return totals.closingBalanceMinor - (totals.openingBalanceMinor + totals.netActivityMinor - totals.payoutsMinor);
}

export function formatMinor(value: bigint | string, currency: string, locale = "en-US") {
  const minor = typeof value === "bigint" ? value : BigInt(value);
  if (!Number.isSafeInteger(Number(minor))) throw new Error("Amount exceeds safe display range");
  const formatter = new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(Number(minor) / (10 ** digits));
}

export function minorDecimal(value: bigint, currency: string) {
  const digits = new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).resolvedOptions().maximumFractionDigits ?? 2;
  const negative = value < BigInt(0); const absolute = negative ? -value : value; const divisor = BigInt(10) ** BigInt(digits);
  const units = absolute / divisor; const remainder = absolute % divisor;
  return `${negative ? "-" : ""}${units}${digits ? `.${remainder.toString().padStart(digits, "0")}` : ""}`;
}
