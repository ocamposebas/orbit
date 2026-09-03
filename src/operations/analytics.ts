import { Prisma } from "@/generated/prisma/client";
import { getDatabase } from "@/sentinel/db";

export type AnalyticsRange = "7d" | "30d" | "90d";
type CurrencyMetric = { currency: string; volumeMinor: number; successful: number; failed: number; total: number; customers: number };
type TrendRow = { day: Date; amountMinor: number; payments: number };
type MerchantMetric = { merchantId: string; merchantName: string; currency: string; amountMinor: number; payments: number };

const daysByRange = { "7d": 7, "30d": 30, "90d": 90 } as const;

export async function getPortalAnalytics(merchantIds: string[], range: AnalyticsRange) {
  if (!merchantIds.length) return { current: [] as CurrencyMetric[], previous: [] as CurrencyMetric[], trend: [] as TrendRow[], topMerchants: [] as MerchantMetric[], primaryCurrency: "USD", range, days: daysByRange[range] };
  const days = daysByRange[range];
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const previousStart = new Date(start.getTime() - days * 86_400_000);
  const db = getDatabase();
  const scope = Prisma.sql`payment."merchantId" IN (${Prisma.join(merchantIds)})`;
  const metricQuery = (from: Date, to: Date) => db.$queryRaw<CurrencyMetric[]>(Prisma.sql`
    SELECT
      payment.currency,
      COALESCE(SUM(payment."amountMinor") FILTER (WHERE payment.status = 'SUCCEEDED'), 0)::double precision AS "volumeMinor",
      COUNT(*) FILTER (WHERE payment.status = 'SUCCEEDED')::integer AS successful,
      COUNT(*) FILTER (WHERE payment.status IN ('FAILED', 'CANCELED'))::integer AS failed,
      COUNT(*)::integer AS total,
      COUNT(DISTINCT (payment."merchantId", LOWER(BTRIM(payment."customerEmail")))) FILTER (WHERE payment."customerEmail" IS NOT NULL)::integer AS customers
    FROM "PaymentTransaction" payment
    WHERE ${scope} AND payment."createdAt" >= ${from} AND payment."createdAt" < ${to}
    GROUP BY payment.currency
    ORDER BY "volumeMinor" DESC
  `);
  const [current, previous, allTrend, topMerchants] = await Promise.all([
    metricQuery(start, end),
    metricQuery(previousStart, start),
    db.$queryRaw<Array<TrendRow & { currency: string }>>(Prisma.sql`
      SELECT DATE_TRUNC('day', payment."createdAt") AS day, payment.currency,
        SUM(payment."amountMinor")::double precision AS "amountMinor", COUNT(*)::integer AS payments
      FROM "PaymentTransaction" payment
      WHERE ${scope} AND payment.status = 'SUCCEEDED' AND payment."createdAt" >= ${start} AND payment."createdAt" < ${end}
      GROUP BY DATE_TRUNC('day', payment."createdAt"), payment.currency
      ORDER BY day ASC
    `),
    db.$queryRaw<MerchantMetric[]>(Prisma.sql`
      SELECT payment."merchantId", merchant."businessName" AS "merchantName", payment.currency,
        SUM(payment."amountMinor")::double precision AS "amountMinor", COUNT(*)::integer AS payments
      FROM "PaymentTransaction" payment
      INNER JOIN "Merchant" merchant ON merchant.id = payment."merchantId"
      WHERE ${scope} AND payment.status = 'SUCCEEDED' AND payment."createdAt" >= ${start} AND payment."createdAt" < ${end}
      GROUP BY payment."merchantId", merchant."businessName", payment.currency
      ORDER BY "amountMinor" DESC
      LIMIT 8
    `),
  ]);
  const primaryCurrency = current[0]?.currency ?? allTrend[0]?.currency ?? "USD";
  return { current, previous, trend: allTrend.filter((point) => point.currency === primaryCurrency), topMerchants, primaryCurrency, range, days };
}

export function analyticsRange(value: string | undefined): AnalyticsRange {
  return value === "7d" || value === "90d" ? value : "30d";
}
