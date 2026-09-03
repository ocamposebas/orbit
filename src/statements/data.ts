import { getDatabase } from "@/sentinel/db";
import { getServerEnv } from "@/sentinel/config";
import { zonedDateToUtc } from "./period";

export async function listMerchantStatements(merchantId: string, year: number) {
  const timeZone = getServerEnv().STATEMENT_TIMEZONE;
  const start = zonedDateToUtc(year, 1, 1, 0, timeZone);
  const end = zonedDateToUtc(year + 1, 1, 1, 0, timeZone);
  const statements = await getDatabase().merchantStatement.findMany({ where: { merchantId, periodStart: { gte: start, lt: end } }, orderBy: [{ periodStart: "desc" }, { currency: "asc" }] });
  const currencies = [...new Set(statements.map((item) => item.currency))];
  const summaries = currencies.map((currency) => {
    const values = statements.filter((item) => item.currency === currency && item.status === "FINALIZED");
    return {
      currency,
      grossPaymentsMinor: values.reduce((sum, item) => sum + item.grossPaymentsMinor, BigInt(0)),
      refundsMinor: values.reduce((sum, item) => sum + item.refundsMinor, BigInt(0)),
      disputesMinor: values.reduce((sum, item) => sum + item.disputesMinor, BigInt(0)),
      processingFeesMinor: values.reduce((sum, item) => sum + item.processingFeesMinor, BigInt(0)),
      orbitFeesMinor: values.reduce((sum, item) => sum + item.orbitFeesMinor, BigInt(0)),
      adjustmentsMinor: values.reduce((sum, item) => sum + item.adjustmentsMinor, BigInt(0)),
      netActivityMinor: values.reduce((sum, item) => sum + item.netActivityMinor, BigInt(0)),
      payoutsMinor: values.reduce((sum, item) => sum + item.payoutsMinor, BigInt(0)),
      months: values.slice().sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime()).map((item) => ({ publicId: item.publicId, periodStart: item.periodStart, grossPaymentsMinor: item.grossPaymentsMinor, refundsMinor: item.refundsMinor, feesMinor: item.processingFeesMinor + item.orbitFeesMinor, netActivityMinor: item.netActivityMinor, payoutsMinor: item.payoutsMinor })),
    };
  });
  return { statements, summaries };
}

export async function getMerchantStatement(merchantId: string, publicId: string) {
  return getDatabase().merchantStatement.findFirst({ where: { merchantId, publicId }, include: { merchant: { include: { agreement: { select: { legalName: true, primaryContactEmail: true } } } }, lineItems: { orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 100 }, payouts: { orderBy: { initiatedAt: "desc" } }, deliveryAttempts: { orderBy: { attempt: "desc" } } } });
}

export async function getAccessibleMerchantStatement(merchantIds: string[], publicId: string) {
  if (merchantIds.length === 0) return null;
  return getDatabase().merchantStatement.findFirst({ where: { merchantId: { in: merchantIds }, publicId }, include: { merchant: { include: { agreement: { select: { legalName: true, primaryContactEmail: true } } } }, lineItems: { orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 100 }, payouts: { orderBy: { initiatedAt: "desc" } }, deliveryAttempts: { orderBy: { attempt: "desc" } } } });
}
