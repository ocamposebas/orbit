import type Stripe from "stripe";
import { getDatabase } from "@/sentinel/db";
import { getStripeClient, getStripeConfiguration, stripeEnvironment } from "@/stripe/client";
import type { StatementLedgerEntry, StatementEntryType } from "./calculation";
import type { StatementPeriod } from "./period";

export type PayoutSnapshot = { externalId: string; initiatedAt: Date; arrivalAt: Date | null; status: string; amountMinor: bigint; currency: string; destinationSummary: string | null };
export type CurrencyLedger = { currency: string; openingBalanceMinor: bigint; entries: StatementLedgerEntry[]; payouts: PayoutSnapshot[] };

function lineType(transaction: Stripe.BalanceTransaction): StatementEntryType {
  const category = transaction.reporting_category.toLowerCase();
  if (transaction.type === "payout" && transaction.net < 0) return "PAYOUT";
  if (category.includes("dispute")) return "DISPUTE";
  if (category.includes("refund") || ["refund", "payment_refund"].includes(transaction.type)) return "REFUND";
  if (["charge", "payment"].includes(transaction.type) && transaction.amount > 0) return "PAYMENT";
  return "ADJUSTMENT";
}

function sourceReference(source: Stripe.BalanceTransaction["source"]) {
  if (!source) return null;
  if (typeof source === "string") return source;
  const candidate = source as unknown as { payment_intent?: string | { id?: string }; id?: string };
  if (typeof candidate.payment_intent === "string") return candidate.payment_intent;
  if (candidate.payment_intent && typeof candidate.payment_intent === "object") return candidate.payment_intent.id ?? candidate.id ?? null;
  return candidate.id ?? null;
}

function mapEntry(transaction: Stripe.BalanceTransaction): StatementLedgerEntry {
  const orbitFee = transaction.fee_details.filter((fee) => fee.type === "application_fee").reduce((sum, fee) => sum + fee.amount, 0);
  const processingFee = transaction.fee_details.filter((fee) => fee.type !== "application_fee").reduce((sum, fee) => sum + fee.amount, 0);
  return {
    externalId: transaction.id,
    type: lineType(transaction),
    processorType: transaction.type,
    reportingCategory: transaction.reporting_category,
    reference: sourceReference(transaction.source),
    description: transaction.description,
    amountMinor: BigInt(transaction.amount),
    processingFeeMinor: BigInt(processingFee),
    orbitFeeMinor: BigInt(orbitFee),
    netMinor: BigInt(transaction.net),
    occurredAt: new Date(transaction.created * 1_000),
  };
}

function destinationSummary(destination: Stripe.Payout["destination"]) {
  if (!destination || typeof destination === "string") return null;
  const value = destination as unknown as { bank_name?: string; brand?: string; last4?: string };
  const name = value.bank_name ?? value.brand;
  return [name, value.last4 ? `•••• ${value.last4}` : null].filter(Boolean).join(" · ") || null;
}

export async function loadAuthoritativeLedger(merchantId: string, period: StatementPeriod): Promise<CurrencyLedger[]> {
  const integration = await getDatabase().stripeConnectIntegration.findUnique({ where: { merchantId } });
  if (!integration) throw new Error("STATEMENT_STRIPE_ACCOUNT_UNAVAILABLE");
  const configuration = getStripeConfiguration();
  if (!configuration.configured || integration.stripeEnvironment !== stripeEnvironment(configuration.mode)) throw new Error("STATEMENT_STRIPE_CONFIGURATION_UNAVAILABLE");
  const stripe = getStripeClient();
  const options = { stripeContext: integration.stripeAccountId };
  const endSeconds = Math.floor(period.end.getTime() / 1_000);
  const startSeconds = Math.floor(period.start.getTime() / 1_000);
  const opening = new Map<string, bigint>();
  const entries = new Map<string, StatementLedgerEntry[]>();

  const transactions = stripe.balanceTransactions.list({ created: { lt: endSeconds }, limit: 100, expand: ["data.source"] }, options);
  for await (const transaction of transactions) {
    const currency = transaction.currency.toUpperCase();
    if (transaction.created < startSeconds) opening.set(currency, (opening.get(currency) ?? BigInt(0)) + BigInt(transaction.net));
    else entries.set(currency, [...(entries.get(currency) ?? []), mapEntry(transaction)]);
  }

  const payoutMap = new Map<string, PayoutSnapshot[]>();
  const payouts = stripe.payouts.list({ created: { gte: startSeconds, lt: endSeconds }, limit: 100, expand: ["data.destination"] }, options);
  for await (const payout of payouts) {
    const currency = payout.currency.toUpperCase();
    payoutMap.set(currency, [...(payoutMap.get(currency) ?? []), {
      externalId: payout.id,
      initiatedAt: new Date(payout.created * 1_000),
      arrivalAt: payout.arrival_date ? new Date(payout.arrival_date * 1_000) : null,
      status: payout.status,
      amountMinor: BigInt(payout.amount),
      currency,
      destinationSummary: destinationSummary(payout.destination),
    }]);
  }

  const currentCurrencies = new Set([...entries.keys(), ...payoutMap.keys()]);
  if (currentCurrencies.size === 0) {
    const lastPayment = await getDatabase().paymentTransaction.findFirst({ where: { merchantId, status: "SUCCEEDED" }, orderBy: { createdAt: "desc" }, select: { currency: true } });
    currentCurrencies.add(lastPayment?.currency.toUpperCase() ?? "USD");
  }
  return [...currentCurrencies].sort().map((currency) => ({ currency, openingBalanceMinor: opening.get(currency) ?? BigInt(0), entries: entries.get(currency) ?? [], payouts: payoutMap.get(currency) ?? [] }));
}
