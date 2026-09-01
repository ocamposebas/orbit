import type Stripe from "stripe";
import { getDatabase } from "@/sentinel/db";
import { childLogger } from "@/sentinel/logger";
import { getStripeClient, getStripeConfiguration, stripeEnvironment } from "@/stripe/client";

const stripePortalLog = childLogger({ component: "merchant-portal-stripe" });

export type StripeFinancialIssue = "not_connected" | "not_configured" | "environment_mismatch" | "authentication" | "permission" | "account_unavailable" | "rate_limited" | "temporarily_unavailable";
export type FinancialProcessorState = "live" | "partial" | "not_connected" | "unavailable";

export function stripeFinancialIssue(error: unknown): StripeFinancialIssue {
  const value = error as { type?: string; code?: string; status?: number; statusCode?: number; message?: string };
  const type = String(value?.type ?? "");
  const code = String(value?.code ?? "");
  const message = String(value?.message ?? "");
  const status = value?.statusCode ?? value?.status;
  if (/not configured|unsupported secret key/i.test(message)) return "not_configured";
  if (/environment.*(?:does not match|mismatch)|does not match STRIPE_MODE/i.test(message)) return "environment_mismatch";
  if (type === "StripeAuthenticationError" || status === 401) return "authentication";
  if (type === "StripePermissionError" || status === 403 || /permission|not authorized|access denied/i.test(message)) return "permission";
  if (value?.statusCode === 429 || type === "StripeRateLimitError") return "rate_limited";
  if (code === "resource_missing" || /no such account|account.*(?:missing|invalid|not found)|not connected to/i.test(message)) return "account_unavailable";
  return "temporarily_unavailable";
}

function logStripeFinancialFailure(merchantId: string, surface: "balance" | "payouts" | "destination", error: unknown) {
  const value = error as { type?: string; code?: string; statusCode?: number };
  stripePortalLog.warn({ merchantId, surface, issue: stripeFinancialIssue(error), stripeErrorType: value?.type, stripeErrorCode: value?.code, stripeStatusCode: value?.statusCode }, "Stripe financial data request failed");
}

export type BalanceAmount = { amountMinor: number | null; currency: string };
export type PortalPayoutSummary = {
  id: string;
  amountMinor: number;
  currency: string;
  arrivalDate: number;
  created: number;
  destination: string;
  status: string;
};
export type PortalPayoutDestination = {
  type: "bank_account" | "card";
  name: string;
  last4: string;
  currency: string | null;
  country: string | null;
  status: string | null;
  defaultForCurrency: boolean;
  expires: string | null;
};
export type PortalPaymentSummary = {
  id: string;
  publicId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  platformFeeMinor: number;
  status: string;
  source: string;
  createdAt: Date;
  stripePaymentIntentId?: string | null;
};
export type VolumePoint = { date: string; amountMinor: number; payments: number };
export type PeriodStatistic = {
  key: "today" | "7d" | "30d" | "90d";
  label: string;
  amountMinor: number;
  payments: number;
  averageMinor: number | null;
  currency: string | null;
  refundsMinor: number | null;
  netRevenueMinor: number | null;
};

type ChargeFinancial = { refundsMinor: number; netMinor: number | null };

function emptyBalance(currency = "USD"): BalanceAmount {
  return { amountMinor: null, currency };
}

function balanceForCurrency(values: Stripe.Balance.Available[], currency: string | undefined) {
  if (!values.length) return { amountMinor: 0, currency: currency ?? "USD" };
  const selected = values.find((item) => item.currency.toUpperCase() === currency) ?? values[0];
  return { amountMinor: selected.amount, currency: selected.currency.toUpperCase() };
}

function destinationLabel(destination: Stripe.Payout["destination"]) {
  if (!destination) return "Destination unavailable";
  if (typeof destination === "string") return "Bank account";
  if (destination.deleted) return "Bank account";
  const last4 = "last4" in destination ? destination.last4 : undefined;
  const kind = destination.object === "card" ? "Card" : "Bank";
  return last4 ? `${kind} •••• ${last4}` : `${kind} account`;
}

function mapPayout(payout: Stripe.Payout): PortalPayoutSummary {
  return {
    id: payout.id,
    amountMinor: payout.amount,
    currency: payout.currency.toUpperCase(),
    arrivalDate: payout.arrival_date,
    created: payout.created,
    destination: destinationLabel(payout.destination),
    status: payout.status,
  };
}

export function payoutDestinationSummary(account: Stripe.ExternalAccount): PortalPayoutDestination {
  if (account.object === "bank_account") {
    return {
      type: "bank_account",
      name: account.bank_name || "Bank account",
      last4: account.last4,
      currency: account.currency?.toUpperCase() ?? null,
      country: account.country ?? null,
      status: account.status ?? null,
      defaultForCurrency: Boolean(account.default_for_currency),
      expires: null,
    };
  }
  return {
    type: "card",
    name: account.brand || "Debit card",
    last4: account.last4,
    currency: account.currency?.toUpperCase() ?? null,
    country: account.country ?? null,
    status: null,
    defaultForCurrency: Boolean(account.default_for_currency),
    expires: `${String(account.exp_month).padStart(2, "0")}/${String(account.exp_year).slice(-2)}`,
  };
}

function selectPayoutDestination(accounts: Stripe.ExternalAccount[], currency?: string) {
  const normalizedCurrency = currency?.toLowerCase();
  const selected = accounts.find((account) => account.default_for_currency && account.currency?.toLowerCase() === normalizedCurrency)
    ?? accounts.find((account) => account.currency?.toLowerCase() === normalizedCurrency)
    ?? accounts.find((account) => account.default_for_currency)
    ?? accounts[0];
  return selected ? payoutDestinationSummary(selected) : null;
}

function payoutExternalAccount(destination: Stripe.Payout["destination"]): Stripe.ExternalAccount | null {
  if (!destination || typeof destination === "string" || destination.deleted) return null;
  return destination.object === "bank_account" || destination.object === "card" ? destination : null;
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function periodStart(days: number) {
  const date = startOfUtcDay();
  date.setUTCDate(date.getUTCDate() - (days - 1));
  return date;
}

function volumeSeries(payments: PortalPaymentSummary[], days = 90): VolumePoint[] {
  const totals = new Map<string, { amountMinor: number; payments: number }>();
  for (const payment of payments) {
    const key = dayKey(payment.createdAt);
    const current = totals.get(key) ?? { amountMinor: 0, payments: 0 };
    totals.set(key, { amountMinor: current.amountMinor + payment.amountMinor, payments: current.payments + 1 });
  }
  return Array.from({ length: days }, (_, index) => {
    const date = periodStart(days - index);
    return { date: dayKey(date), ...(totals.get(dayKey(date)) ?? { amountMinor: 0, payments: 0 }) };
  });
}

function periodStatistics(payments: PortalPaymentSummary[], financials: Map<string, ChargeFinancial> | null): PeriodStatistic[] {
  const periods = [
    { key: "today" as const, label: "Today", days: 1 },
    { key: "7d" as const, label: "Last 7 days", days: 7 },
    { key: "30d" as const, label: "Last 30 days", days: 30 },
    { key: "90d" as const, label: "Last 90 days", days: 90 },
  ];
  return periods.map((period) => {
    const start = periodStart(period.days);
    const values = payments.filter((payment) => payment.createdAt >= start);
    const currencies = [...new Set(values.map((payment) => payment.currency))];
    const safeValues = currencies.length <= 1 ? values : [];
    const amountMinor = safeValues.reduce((sum, payment) => sum + payment.amountMinor, 0);
    const matchedFinancials = safeValues.flatMap((payment) => payment.stripePaymentIntentId && financials?.has(payment.stripePaymentIntentId) ? [financials.get(payment.stripePaymentIntentId)!] : []);
    const completeFinancials = Boolean(financials) && matchedFinancials.length === safeValues.length;
    const refundsMinor = completeFinancials ? matchedFinancials.reduce((sum, item) => sum + item.refundsMinor, 0) : null;
    const netRevenueMinor = completeFinancials && matchedFinancials.every((item) => item.netMinor !== null && item.refundsMinor === 0)
      ? matchedFinancials.reduce((sum, item) => sum + (item.netMinor ?? 0), 0)
      : null;
    return {
      key: period.key,
      label: period.label,
      amountMinor,
      payments: values.length,
      averageMinor: safeValues.length ? Math.round(amountMinor / safeValues.length) : null,
      currency: currencies.length === 1 ? currencies[0] : null,
      refundsMinor,
      netRevenueMinor,
    };
  });
}

async function chargeFinancialsForPayments(processor: StripeMerchant, payments: PortalPaymentSummary[]) {
  const intentIds = new Set(payments.flatMap((payment) => payment.stripePaymentIntentId ? [payment.stripePaymentIntentId] : []));
  const financials = new Map<string, ChargeFinancial>();
  if (!intentIds.size) return financials;
  try {
    const charges = processor.stripe.charges.list(
      { created: { gte: Math.floor(periodStart(90).getTime() / 1_000) }, limit: 100, expand: ["data.balance_transaction"] },
      { stripeContext: processor.accountId },
    );
    for await (const charge of charges) {
      const intentId = charge.payment_intent ? (typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent.id) : null;
      if (!intentId || !intentIds.has(intentId)) continue;
      const balance = chargeBalance(charge);
      financials.set(intentId, { refundsMinor: charge.amount_refunded, netMinor: balance?.net ?? null });
    }
    return financials;
  } catch {
    return null;
  }
}

export async function getMerchantOverview(merchantId: string) {
  const db = getDatabase();
  const [merchant, transactions] = await Promise.all([
    db.merchant.findUnique({
      where: { id: merchantId },
      select: { stripeConnect: true },
    }),
    db.paymentTransaction.findMany({
      where: { merchantId, status: "SUCCEEDED", createdAt: { gte: periodStart(90) } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        publicPaymentId: true,
        wooOrderId: true,
        amountMinor: true,
        currency: true,
        platformFeeMinor: true,
        status: true,
        source: true,
        createdAt: true,
        stripePaymentIntentId: true,
      },
    }),
  ]);

  const payments: PortalPaymentSummary[] = transactions.map((transaction) => ({
    id: transaction.id,
    publicId: transaction.publicPaymentId ?? transaction.id,
    orderId: transaction.wooOrderId,
    amountMinor: transaction.amountMinor,
    currency: transaction.currency,
    platformFeeMinor: transaction.platformFeeMinor,
    status: transaction.status,
    source: transaction.source,
    createdAt: transaction.createdAt,
    stripePaymentIntentId: transaction.stripePaymentIntentId,
  }));
  const primaryCurrency = payments[0]?.currency;
  let available = emptyBalance(primaryCurrency);
  let pending = emptyBalance(primaryCurrency);
  let nextPayout: PortalPayoutSummary | null = null;
  let processorState: FinancialProcessorState = merchant?.stripeConnect ? "unavailable" : "not_connected";
  let balanceAvailable = false;
  let payoutsAvailable = false;
  let balanceIssue: StripeFinancialIssue | null = merchant?.stripeConnect ? null : "not_connected";
  let payoutsIssue: StripeFinancialIssue | null = merchant?.stripeConnect ? null : "not_connected";
  let financials: Map<string, ChargeFinancial> | null = null;

  if (merchant?.stripeConnect) {
    try {
      const configuration = getStripeConfiguration();
      if (!configuration.configured) {
        balanceIssue = "not_configured";
        payoutsIssue = "not_configured";
        throw new Error("stripe_not_configured");
      }
      if (merchant.stripeConnect.stripeEnvironment !== stripeEnvironment(configuration.mode)) {
        balanceIssue = "environment_mismatch";
        payoutsIssue = "environment_mismatch";
        throw new Error("stripe_environment_mismatch");
      }
      const stripe = getStripeClient();
      const options = { stripeContext: merchant.stripeConnect.stripeAccountId };
      const [balanceResult, payoutsResult] = await Promise.allSettled([
        stripe.balance.retrieve({}, options),
        stripe.payouts.list({ limit: 25, expand: ["data.destination"] }, options),
      ]);
      if (balanceResult.status === "fulfilled") {
        available = balanceForCurrency(balanceResult.value.available, primaryCurrency);
        pending = balanceForCurrency(balanceResult.value.pending, available.currency);
        balanceAvailable = true;
        balanceIssue = null;
      } else {
        balanceIssue = stripeFinancialIssue(balanceResult.reason);
        logStripeFinancialFailure(merchantId, "balance", balanceResult.reason);
      }
      if (payoutsResult.status === "fulfilled") {
        const upcoming = payoutsResult.value.data
          .filter((payout) => ["pending", "in_transit"].includes(payout.status))
          .sort((a, b) => a.arrival_date - b.arrival_date)[0];
        nextPayout = upcoming ? mapPayout(upcoming) : null;
        payoutsAvailable = true;
        payoutsIssue = null;
      } else {
        payoutsIssue = stripeFinancialIssue(payoutsResult.reason);
        logStripeFinancialFailure(merchantId, "payouts", payoutsResult.reason);
      }
      processorState = balanceAvailable && payoutsAvailable ? "live" : balanceAvailable || payoutsAvailable ? "partial" : "unavailable";
      financials = await chargeFinancialsForPayments({ accountId: merchant.stripeConnect.stripeAccountId, stripe }, payments);
    } catch (error) {
      if (!balanceIssue) balanceIssue = stripeFinancialIssue(error);
      if (!payoutsIssue) payoutsIssue = stripeFinancialIssue(error);
      processorState = "unavailable";
    }
  }

  return {
    available,
    pending,
    nextPayout,
    statistics: periodStatistics(payments, financials),
    volume: volumeSeries(primaryCurrency ? payments.filter((payment) => payment.currency === primaryCurrency) : payments),
    volumeCurrency: primaryCurrency ?? available.currency,
    recentPayments: payments.slice(0, 6),
    updatedAt: new Date(),
    processorState,
    balanceAvailable,
    payoutsAvailable,
    balanceIssue,
    payoutsIssue,
  };
}

export type PortfolioMerchant = { id: string; businessName: string; portalEnabled: boolean };

export async function getAdminPortfolioOverview(merchants: PortfolioMerchant[]) {
  const db = getDatabase();
  const merchantIds = merchants.map((merchant) => merchant.id);
  const [transactions, overviews, latestSuccessful] = await Promise.all([
    db.paymentTransaction.findMany({
      where: { merchantId: { in: merchantIds }, status: "SUCCEEDED", createdAt: { gte: periodStart(90) } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        publicPaymentId: true,
        merchantId: true,
        wooOrderId: true,
        amountMinor: true,
        currency: true,
        platformFeeMinor: true,
        status: true,
        source: true,
        createdAt: true,
      },
    }),
    Promise.all(merchants.map(async (merchant) => ({ merchant, overview: await getMerchantOverview(merchant.id) }))),
    db.paymentTransaction.findFirst({
      where: { merchantId: { in: merchantIds }, status: "SUCCEEDED" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { currency: true },
    }),
  ]);
  const merchantNames = new Map(merchants.map((merchant) => [merchant.id, merchant.businessName]));
  const primaryCurrency = transactions[0]?.currency ?? latestSuccessful?.currency ?? overviews.map((item) => item.overview.available.currency).find(Boolean) ?? "USD";
  const currencyTransactions = transactions.filter((transaction) => transaction.currency === primaryCurrency);
  const periods = [
    { key: "today" as const, label: "Today", days: 1 },
    { key: "7d" as const, label: "Last 7 days", days: 7 },
    { key: "30d" as const, label: "Last 30 days", days: 30 },
    { key: "90d" as const, label: "Last 90 days", days: 90 },
  ].map((period) => {
    const values = currencyTransactions.filter((transaction) => transaction.createdAt >= periodStart(period.days));
    return {
      ...period,
      grossMinor: values.reduce((sum, transaction) => sum + transaction.amountMinor, 0),
      orbitRevenueMinor: values.reduce((sum, transaction) => sum + transaction.platformFeeMinor, 0),
      payments: values.length,
    };
  });
  const lifetimeOrbitRevenue = await db.paymentTransaction.aggregate({
    where: { merchantId: { in: merchantIds }, status: "SUCCEEDED", currency: primaryCurrency },
    _sum: { platformFeeMinor: true },
  });
  const liveBalances = overviews.filter((item) => item.overview.balanceAvailable);
  const available = liveBalances.filter((item) => item.overview.available.amountMinor !== null && item.overview.available.currency === primaryCurrency).reduce((sum, item) => sum + (item.overview.available.amountMinor ?? 0), 0);
  const pending = liveBalances.filter((item) => item.overview.pending.amountMinor !== null && item.overview.pending.currency === primaryCurrency).reduce((sum, item) => sum + (item.overview.pending.amountMinor ?? 0), 0);
  const nextPayouts = overviews.flatMap((item) => item.overview.nextPayout ? [{ ...item.overview.nextPayout, merchantId: item.merchant.id, merchantName: item.merchant.businessName }] : []);
  return {
    currency: primaryCurrency,
    periods,
    orbitEarnings: {
      todayMinor: periods.find((period) => period.key === "today")?.orbitRevenueMinor ?? 0,
      sevenDayMinor: periods.find((period) => period.key === "7d")?.orbitRevenueMinor ?? 0,
      thirtyDayMinor: periods.find((period) => period.key === "30d")?.orbitRevenueMinor ?? 0,
      lifetimeMinor: lifetimeOrbitRevenue._sum.platformFeeMinor ?? 0,
    },
    available: { amountMinor: liveBalances.length ? available : null, currency: primaryCurrency },
    pending: { amountMinor: liveBalances.length ? pending : null, currency: primaryCurrency },
    nextPayoutTotalMinor: nextPayouts.filter((payout) => payout.currency === primaryCurrency).reduce((sum, payout) => sum + payout.amountMinor, 0),
    nextPayouts: nextPayouts.sort((left, right) => left.arrivalDate - right.arrivalDate),
    liveMerchantCount: liveBalances.length,
    brands: overviews.map(({ merchant, overview }) => {
      const today = overview.statistics.find((statistic) => statistic.key === "today");
      const thirtyDays = overview.statistics.find((statistic) => statistic.key === "30d");
      const todayTransactions = currencyTransactions.filter((transaction) => transaction.merchantId === merchant.id && transaction.createdAt >= periodStart(1));
      return {
        ...merchant,
        processorState: overview.processorState,
        balanceAvailable: overview.balanceAvailable,
        payoutsAvailable: overview.payoutsAvailable,
        balanceIssue: overview.balanceIssue,
        payoutsIssue: overview.payoutsIssue,
        todayGrossMinor: today?.currency === primaryCurrency ? today.amountMinor : 0,
        todayPayments: today?.payments ?? 0,
        todayOrbitRevenueMinor: todayTransactions.reduce((sum, transaction) => sum + transaction.platformFeeMinor, 0),
        thirtyDayGrossMinor: thirtyDays?.currency === primaryCurrency ? thirtyDays.amountMinor : 0,
        available: overview.available,
        pending: overview.pending,
        nextPayout: overview.nextPayout,
      };
    }).sort((left, right) => right.todayGrossMinor - left.todayGrossMinor),
    volume: volumeSeries(currencyTransactions.map((transaction) => ({
      id: transaction.id,
      publicId: transaction.publicPaymentId ?? transaction.id,
      orderId: transaction.wooOrderId,
      amountMinor: transaction.amountMinor,
      currency: transaction.currency,
      platformFeeMinor: transaction.platformFeeMinor,
      status: transaction.status,
      source: transaction.source,
      createdAt: transaction.createdAt,
    }))),
    recentPayments: transactions.slice(0, 10).map((transaction) => ({
      ...transaction,
      publicId: transaction.publicPaymentId ?? transaction.id,
      orderId: transaction.wooOrderId,
      merchantName: merchantNames.get(transaction.merchantId) ?? "Merchant",
    })),
    updatedAt: new Date(),
  };
}

export type PortalPaymentRow = PortalPaymentSummary & {
  customerEmail: string | null;
  methodBrand: string | null;
  methodLast4: string | null;
  methodType: string | null;
  processingFeeMinor: number | null;
  netMinor: number | null;
  refundAmountMinor: number;
  displayStatus: string;
};

export type PaymentListInput = {
  query?: string;
  status?: string;
  range?: string;
  from?: string;
  to?: string;
  cursor?: string;
  direction?: "next" | "prev";
};

type StripeMerchant = { accountId: string; stripe: ReturnType<typeof getStripeClient> };

async function stripeMerchantConnection(merchantId: string): Promise<{ processor: StripeMerchant | null; issue: StripeFinancialIssue | null }> {
  const integration = await getDatabase().stripeConnectIntegration.findUnique({ where: { merchantId } });
  if (!integration) return { processor: null, issue: "not_connected" };
  try {
    const configuration = getStripeConfiguration();
    if (!configuration.configured) return { processor: null, issue: "not_configured" };
    if (integration.stripeEnvironment !== stripeEnvironment(configuration.mode)) return { processor: null, issue: "environment_mismatch" };
    return { processor: { accountId: integration.stripeAccountId, stripe: getStripeClient() }, issue: null };
  } catch (error) {
    return { processor: null, issue: stripeFinancialIssue(error) };
  }
}

async function stripeMerchant(merchantId: string): Promise<StripeMerchant | null> {
  return (await stripeMerchantConnection(merchantId)).processor;
}

function cursorValue(value: string | undefined) {
  if (!value) return null;
  try {
    const [timestamp, id] = Buffer.from(value, "base64url").toString("utf8").split("|");
    const date = new Date(timestamp);
    if (!id || Number.isNaN(date.getTime())) return null;
    return { date, id };
  } catch {
    return null;
  }
}

function encodeCursor(value: { createdAt: Date; id: string }) {
  return Buffer.from(`${value.createdAt.toISOString()}|${value.id}`, "utf8").toString("base64url");
}

function dateBounds(input: PaymentListInput) {
  const end = input.to && /^\d{4}-\d{2}-\d{2}$/.test(input.to) ? new Date(`${input.to}T23:59:59.999Z`) : undefined;
  if (input.range === "custom" && input.from && /^\d{4}-\d{2}-\d{2}$/.test(input.from)) return { gte: new Date(`${input.from}T00:00:00Z`), ...(end ? { lte: end } : {}) };
  const days = input.range === "today" ? 1 : input.range === "7d" ? 7 : input.range === "30d" ? 30 : input.range === "90d" ? 90 : null;
  return days ? { gte: periodStart(days), ...(end ? { lte: end } : {}) } : end ? { lte: end } : undefined;
}

function databaseStatuses(status: string | undefined) {
  if (status === "succeeded" || status === "refunded" || status === "partially_refunded" || status === "disputed") return ["SUCCEEDED"] as const;
  if (status === "pending") return ["CREATED", "REQUIRES_PAYMENT", "PROCESSING"] as const;
  if (status === "failed") return ["FAILED", "CANCELED"] as const;
  return undefined;
}

function cardDetails(charge: Stripe.Charge | null) {
  const details = charge?.payment_method_details;
  const card = details?.card;
  const bank = details?.us_bank_account;
  const brand = card?.brand ?? (details?.type === "link" ? "Link" : details?.type?.replaceAll("_", " ") ?? null);
  const last4 = card?.last4 ?? bank?.last4 ?? null;
  const wallet = card?.wallet?.type?.replaceAll("_", " ") ?? null;
  return { brand, last4, type: wallet ?? details?.type?.replaceAll("_", " ") ?? null };
}

function chargeBalance(charge: Stripe.Charge | null) {
  return charge && typeof charge.balance_transaction === "object" ? charge.balance_transaction : null;
}

function processingFee(balance: Stripe.BalanceTransaction | null) {
  if (!balance) return null;
  const details = balance.fee_details.filter((fee) => ["stripe_fee", "payment_method_passthrough_fee"].includes(fee.type));
  return details.length ? details.reduce((sum, fee) => sum + fee.amount, 0) : null;
}

async function retrievePaymentIntent(stripeMerchantValue: StripeMerchant | null, stripePaymentIntentId: string | null) {
  if (!stripeMerchantValue || !stripePaymentIntentId) return null;
  try {
    return await stripeMerchantValue.stripe.paymentIntents.retrieve(
      stripePaymentIntentId,
      { expand: ["latest_charge.balance_transaction"] },
      { stripeContext: stripeMerchantValue.accountId },
    );
  } catch {
    return null;
  }
}

async function stripeSearchIntentIds(processor: StripeMerchant | null, query: string | undefined) {
  if (!processor || !query) return [] as string[];
  const trimmed = query.trim();
  const escaped = trimmed.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  const search = /^\d{4}$/.test(trimmed)
    ? `payment_method_details.card.last4:'${escaped}'`
    : trimmed.includes("@")
      ? `billing_details.email:'${escaped}'`
      : null;
  if (!search) return [] as string[];
  try {
    const charges = await processor.stripe.charges.search({ query: search, limit: 100 }, { stripeContext: processor.accountId });
    return charges.data.flatMap((charge) => charge.payment_intent
      ? [typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent.id]
      : []);
  } catch {
    return [] as string[];
  }
}

function intentCharge(intent: Stripe.PaymentIntent | null) {
  return intent && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
}

function displayPaymentStatus(base: string, charge: Stripe.Charge | null) {
  if (charge?.disputed) return "Disputed";
  if (charge?.amount_refunded && charge.amount_refunded >= charge.amount) return "Refunded";
  if (charge?.amount_refunded) return "Partially refunded";
  if (base === "SUCCEEDED") return "Succeeded";
  if (["CREATED", "REQUIRES_PAYMENT", "PROCESSING"].includes(base)) return "Pending";
  return "Failed";
}

async function enrichPayment(
  transaction: {
    id: string; publicPaymentId: string | null; wooOrderId: string; amountMinor: number; currency: string;
    platformFeeMinor: number; status: string; source: string; createdAt: Date; stripePaymentIntentId: string | null;
    ecwidSession: { customerEmail: string | null } | null;
  },
  processor: StripeMerchant | null,
): Promise<PortalPaymentRow> {
  const intent = await retrievePaymentIntent(processor, transaction.stripePaymentIntentId);
  const charge = intentCharge(intent);
  const balance = chargeBalance(charge);
  const method = cardDetails(charge);
  return {
    id: transaction.id,
    publicId: transaction.publicPaymentId ?? transaction.id,
    orderId: transaction.wooOrderId,
    amountMinor: transaction.amountMinor,
    currency: transaction.currency,
    platformFeeMinor: transaction.platformFeeMinor,
    status: transaction.status,
    source: transaction.source,
    createdAt: transaction.createdAt,
    customerEmail: charge?.billing_details.email ?? charge?.receipt_email ?? transaction.ecwidSession?.customerEmail ?? null,
    methodBrand: method.brand,
    methodLast4: method.last4,
    methodType: method.type,
    processingFeeMinor: processingFee(balance),
    netMinor: balance?.net ?? null,
    refundAmountMinor: charge?.amount_refunded ?? 0,
    displayStatus: displayPaymentStatus(transaction.status, charge),
  };
}

function paymentMatchesStripeFilter(payment: PortalPaymentRow, status: string | undefined) {
  if (!status || status === "all") return true;
  const normalized = payment.displayStatus.toLowerCase().replaceAll(" ", "_");
  return normalized === status;
}

function paymentMatchesEnrichedSearch(payment: PortalPaymentRow, query: string | undefined) {
  if (!query) return true;
  const needle = query.trim().toLowerCase();
  return [payment.customerEmail, payment.methodLast4, payment.publicId, payment.orderId].some((value) => value?.toLowerCase().includes(needle));
}

export async function getMerchantPayments(merchantId: string, input: PaymentListInput) {
  const cursor = cursorValue(input.cursor);
  const previous = input.direction === "prev";
  const query = input.query?.trim().slice(0, 120);
  const processor = await stripeMerchant(merchantId);
  const searchedIntentIds = await stripeSearchIntentIds(processor, query);
  const statuses = databaseStatuses(input.status);
  const cursorCondition = cursor ? previous
    ? { OR: [{ createdAt: { gt: cursor.date } }, { createdAt: cursor.date, id: { gt: cursor.id } }] }
    : { OR: [{ createdAt: { lt: cursor.date } }, { createdAt: cursor.date, id: { lt: cursor.id } }] }
    : {};
  const searchCondition = query ? { OR: [
    { id: { contains: query, mode: "insensitive" as const } },
    { publicPaymentId: { contains: query, mode: "insensitive" as const } },
    { wooOrderId: { contains: query, mode: "insensitive" as const } },
    { stripePaymentIntentId: { contains: query, mode: "insensitive" as const } },
    ...(searchedIntentIds.length ? [{ stripePaymentIntentId: { in: searchedIntentIds } }] : []),
    { ecwidSession: { customerEmail: { contains: query, mode: "insensitive" as const } } },
  ] } : null;
  const where = {
    merchantId,
    ...(statuses ? { status: { in: [...statuses] } } : {}),
    ...(dateBounds(input) ? { createdAt: dateBounds(input) } : {}),
    ...((searchCondition || cursor) ? { AND: [...(searchCondition ? [searchCondition] : []), ...(cursor ? [cursorCondition] : [])] } : {}),
  };
  const transactions = await getDatabase().paymentTransaction.findMany({
    where,
    take: 21,
    orderBy: [{ createdAt: previous ? "asc" : "desc" }, { id: previous ? "asc" : "desc" }],
    include: { ecwidSession: { select: { customerEmail: true } } },
  });
  const hasMore = transactions.length > 20;
  const page = transactions.slice(0, 20);
  if (previous) page.reverse();
  const enriched = await Promise.all(page.map((transaction) => enrichPayment(transaction, processor)));
  const payments = enriched.filter((payment) => paymentMatchesStripeFilter(payment, input.status) && paymentMatchesEnrichedSearch(payment, query));

  return {
    payments,
    nextCursor: page.length && (!previous ? hasMore : Boolean(cursor)) ? encodeCursor(page.at(-1)!) : null,
    previousCursor: page.length && (previous ? hasMore : Boolean(cursor)) ? encodeCursor(page[0]) : null,
    processorAvailable: Boolean(processor),
  };
}

export async function getAdminPayments(merchantIds: string[], input: PaymentListInput) {
  const cursor = cursorValue(input.cursor);
  const previous = input.direction === "prev";
  const query = input.query?.trim().slice(0, 120);
  const statuses = databaseStatuses(input.status);
  const cursorCondition = cursor ? previous
    ? { OR: [{ createdAt: { gt: cursor.date } }, { createdAt: cursor.date, id: { gt: cursor.id } }] }
    : { OR: [{ createdAt: { lt: cursor.date } }, { createdAt: cursor.date, id: { lt: cursor.id } }] }
    : null;
  const searchCondition = query ? { OR: [
    { id: { contains: query, mode: "insensitive" as const } },
    { publicPaymentId: { contains: query, mode: "insensitive" as const } },
    { wooOrderId: { contains: query, mode: "insensitive" as const } },
    { stripePaymentIntentId: { contains: query, mode: "insensitive" as const } },
    { merchant: { businessName: { contains: query, mode: "insensitive" as const } } },
    { ecwidSession: { customerEmail: { contains: query, mode: "insensitive" as const } } },
  ] } : null;
  const transactions = await getDatabase().paymentTransaction.findMany({
    where: {
      merchantId: { in: merchantIds },
      ...(statuses ? { status: { in: [...statuses] } } : {}),
      ...(dateBounds(input) ? { createdAt: dateBounds(input) } : {}),
      ...((searchCondition || cursorCondition) ? { AND: [...(searchCondition ? [searchCondition] : []), ...(cursorCondition ? [cursorCondition] : [])] } : {}),
    },
    take: 31,
    orderBy: [{ createdAt: previous ? "asc" : "desc" }, { id: previous ? "asc" : "desc" }],
    include: { merchant: { select: { id: true, businessName: true } }, ecwidSession: { select: { customerEmail: true } } },
  });
  const hasMore = transactions.length > 30;
  const page = transactions.slice(0, 30);
  if (previous) page.reverse();
  return {
    payments: page.map((transaction) => ({
      id: transaction.id,
      publicId: transaction.publicPaymentId ?? transaction.id,
      orderId: transaction.wooOrderId,
      merchantId: transaction.merchant.id,
      merchantName: transaction.merchant.businessName,
      customerEmail: transaction.ecwidSession?.customerEmail ?? null,
      amountMinor: transaction.amountMinor,
      currency: transaction.currency,
      platformFeeMinor: transaction.platformFeeMinor,
      merchantAfterOrbitFeeMinor: transaction.amountMinor - transaction.platformFeeMinor,
      status: displayPaymentStatus(transaction.status, null),
      source: transaction.source,
      createdAt: transaction.createdAt,
    })),
    nextCursor: page.length && (!previous ? hasMore : Boolean(cursor)) ? encodeCursor(page.at(-1)!) : null,
    previousCursor: page.length && (previous ? hasMore : Boolean(cursor)) ? encodeCursor(page[0]) : null,
  };
}

export type PortalPaymentDetail = PortalPaymentRow & {
  stripePaymentIntentId: string | null;
  chargeId: string | null;
  customerName: string | null;
  billingCountry: string | null;
  currency: string;
  processorStatus: string | null;
  succeededAt: Date | null;
  fundsAvailableOn: number | null;
  dispute: { status: string; amountMinor: number } | null;
  payout: PortalPayoutSummary | null;
};

async function findPaymentPayout(processor: StripeMerchant, charge: Stripe.Charge, balance: Stripe.BalanceTransaction | null) {
  if (!balance || balance.status !== "available") return null;
  try {
    const payouts = await processor.stripe.payouts.list({ limit: 12, expand: ["data.destination"] }, { stripeContext: processor.accountId });
    for (const payout of payouts.data.filter((item) => item.reconciliation_status === "completed")) {
      const result = await processor.stripe.balanceTransactions.list({ payout: payout.id, source: charge.id, limit: 1 }, { stripeContext: processor.accountId });
      if (result.data.some((item) => item.id === balance.id)) return mapPayout(payout);
    }
  } catch {
    return null;
  }
  return null;
}

export async function getMerchantPayment(merchantId: string, paymentId: string): Promise<PortalPaymentDetail | null> {
  const transaction = await getDatabase().paymentTransaction.findFirst({
    where: { merchantId, OR: [{ id: paymentId }, { publicPaymentId: paymentId }] },
    include: {
      ecwidSession: { select: { customerEmail: true } },
      paymentEvents: { where: { type: "payment_intent.succeeded" }, orderBy: { createdAt: "asc" }, take: 1, select: { createdAt: true } },
    },
  });
  if (!transaction) return null;
  const processor = await stripeMerchant(merchantId);
  const intent = await retrievePaymentIntent(processor, transaction.stripePaymentIntentId);
  const charge = intentCharge(intent);
  const balance = chargeBalance(charge);
  const row = await enrichPayment(transaction, processor);
  let dispute: PortalPaymentDetail["dispute"] = null;
  if (processor && charge?.disputed) {
    try {
      const disputes = await processor.stripe.disputes.list({ charge: charge.id, limit: 1 }, { stripeContext: processor.accountId });
      const current = disputes.data[0];
      if (current) dispute = { status: current.status, amountMinor: current.amount };
    } catch { /* Stripe detail remains unavailable without changing the known disputed state. */ }
  }
  const payout = processor && charge ? await findPaymentPayout(processor, charge, balance) : null;
  return {
    ...row,
    stripePaymentIntentId: transaction.stripePaymentIntentId,
    chargeId: charge?.id ?? null,
    customerName: charge?.billing_details.name ?? null,
    customerEmail: charge?.billing_details.email ?? charge?.receipt_email ?? transaction.ecwidSession?.customerEmail ?? null,
    billingCountry: charge?.billing_details.address?.country ?? null,
    processorStatus: intent?.status ?? null,
    succeededAt: transaction.paymentEvents[0]?.createdAt ?? null,
    fundsAvailableOn: balance?.available_on ?? null,
    dispute,
    payout,
  };
}

export type PayoutListInput = { cursor?: string };

export async function getMerchantPayouts(merchantId: string, input: PayoutListInput = {}) {
  const connection = await stripeMerchantConnection(merchantId);
  const processor = connection.processor;
  if (!processor) return { payouts: [] as PortalPayoutSummary[], hasMore: false, nextCursor: null, processorAvailable: false, balanceAvailable: false, payoutsAvailable: false, balanceIssue: connection.issue, payoutsIssue: connection.issue, payoutSchedule: null, destination: null as PortalPayoutDestination | null, available: emptyBalance(), pending: emptyBalance() };
  const [balanceResult, payoutsResult, settingsResult, destinationsResult] = await Promise.allSettled([
    processor.stripe.balance.retrieve({}, { stripeContext: processor.accountId }),
    processor.stripe.payouts.list({ limit: 20, ...(input.cursor ? { starting_after: input.cursor } : {}), expand: ["data.destination"] }, { stripeContext: processor.accountId }),
    processor.stripe.balanceSettings.retrieve({}, { stripeContext: processor.accountId }),
    processor.stripe.accounts.listExternalAccounts(processor.accountId, { limit: 10 }),
  ]);
  if (balanceResult.status === "rejected") logStripeFinancialFailure(merchantId, "balance", balanceResult.reason);
  if (payoutsResult.status === "rejected") logStripeFinancialFailure(merchantId, "payouts", payoutsResult.reason);
  if (destinationsResult.status === "rejected") logStripeFinancialFailure(merchantId, "destination", destinationsResult.reason);
  const balance = balanceResult.status === "fulfilled" ? balanceResult.value : null;
  const payouts = payoutsResult.status === "fulfilled" ? payoutsResult.value : null;
  const primaryCurrency = balance?.available[0]?.currency.toUpperCase();
  const externalAccounts = destinationsResult.status === "fulfilled" ? destinationsResult.value.data : [];
  const payoutFallback = payouts?.data.map((payout) => payoutExternalAccount(payout.destination)).find((destination) => destination !== null) ?? null;
  return {
    payouts: payouts?.data.map(mapPayout) ?? [],
    hasMore: payouts?.has_more ?? false,
    nextCursor: payouts?.has_more ? payouts.data.at(-1)?.id ?? null : null,
    processorAvailable: Boolean(balance || payouts),
    balanceAvailable: Boolean(balance),
    payoutsAvailable: Boolean(payouts),
    balanceIssue: balanceResult.status === "rejected" ? stripeFinancialIssue(balanceResult.reason) : null,
    payoutsIssue: payoutsResult.status === "rejected" ? stripeFinancialIssue(payoutsResult.reason) : null,
    payoutSchedule: settingsResult.status === "fulfilled" ? settingsResult.value.payments.payouts?.schedule?.interval ?? null : null,
    destination: selectPayoutDestination(externalAccounts, primaryCurrency) ?? (payoutFallback ? payoutDestinationSummary(payoutFallback) : null),
    available: balance ? balanceForCurrency(balance.available, primaryCurrency) : emptyBalance(),
    pending: balance ? balanceForCurrency(balance.pending, primaryCurrency) : emptyBalance(),
  };
}

export type PortalPayoutDetail = PortalPayoutSummary & {
  failureMessage: string | null;
  traceId: string | null;
  payments: PortalPaymentSummary[];
  paymentsHasMore: boolean;
};

export async function getMerchantPayout(merchantId: string, payoutId: string, cursor?: string): Promise<PortalPayoutDetail | null> {
  const processor = await stripeMerchant(merchantId);
  if (!processor || !/^po_[A-Za-z0-9_]+$/.test(payoutId)) return null;
  try {
    const payout = await processor.stripe.payouts.retrieve(payoutId, { expand: ["destination"] }, { stripeContext: processor.accountId });
    const transactions = await processor.stripe.balanceTransactions.list({ payout: payout.id, limit: 51, ...(cursor ? { starting_after: cursor } : {}) }, { stripeContext: processor.accountId });
    const chargeIds = transactions.data.flatMap((item) => {
      if (typeof item.source === "string" && item.source.startsWith("ch_")) return [item.source];
      if (typeof item.source === "object" && item.source?.object === "charge") return [item.source.id];
      return [];
    });
    const charges = await Promise.all(chargeIds.map(async (chargeId) => {
      try { return await processor.stripe.charges.retrieve(chargeId, {}, { stripeContext: processor.accountId }); }
      catch { return null; }
    }));
    const intentIds = charges.flatMap((charge) => {
      if (!charge?.payment_intent) return [];
      return [typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent.id];
    });
    const included = intentIds.length ? await getDatabase().paymentTransaction.findMany({
      where: { merchantId, stripePaymentIntentId: { in: intentIds } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }) : [];
    const payments: PortalPaymentSummary[] = included.map((transaction) => ({
      id: transaction.id,
      publicId: transaction.publicPaymentId ?? transaction.id,
      orderId: transaction.wooOrderId,
      amountMinor: transaction.amountMinor,
      currency: transaction.currency,
      platformFeeMinor: transaction.platformFeeMinor,
      status: transaction.status,
      source: transaction.source,
      createdAt: transaction.createdAt,
      stripePaymentIntentId: transaction.stripePaymentIntentId,
    }));
    return {
      ...mapPayout(payout),
      failureMessage: payout.failure_message,
      traceId: payout.trace_id?.value ?? null,
      payments,
      paymentsHasMore: transactions.has_more,
    };
  } catch {
    return null;
  }
}
