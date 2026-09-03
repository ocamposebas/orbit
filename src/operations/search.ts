import { Prisma } from "@/generated/prisma/client";
import { getDatabase } from "@/sentinel/db";

export type GlobalSearchResult = {
  id: string;
  kind: "customer" | "payment" | "statement" | "scan" | "merchant";
  label: string;
  description: string;
  href: string;
  merchantId?: string;
};

type CustomerSearchRow = { customerKey: string; merchantId: string; merchantName: string; email: string; name: string | null };

export async function globalPortalSearch(merchantIds: string[], rawQuery: string) {
  const query = rawQuery.trim().slice(0, 100);
  if (query.length < 2 || !merchantIds.length) return [] as GlobalSearchResult[];
  const db = getDatabase();
  const contains = { contains: query, mode: "insensitive" as const };
  const [merchants, payments, statements, scans, customers] = await Promise.all([
    db.merchant.findMany({ where: { id: { in: merchantIds }, businessName: contains }, take: 5, select: { id: true, businessName: true, status: true } }),
    db.paymentTransaction.findMany({ where: { merchantId: { in: merchantIds }, OR: [{ publicPaymentId: contains }, { wooOrderId: contains }, { stripePaymentIntentId: contains }, { customerEmail: contains }, { customerName: contains }] }, orderBy: { createdAt: "desc" }, take: 6, include: { merchant: { select: { businessName: true } } } }),
    db.merchantStatement.findMany({ where: { merchantId: { in: merchantIds }, publicId: contains }, orderBy: { periodStart: "desc" }, take: 5, include: { merchant: { select: { businessName: true } } } }),
    db.scan.findMany({ where: { merchantId: { in: merchantIds }, OR: [{ id: contains }, { site: { hostname: contains } }] }, orderBy: { createdAt: "desc" }, take: 5, include: { merchant: { select: { businessName: true } }, site: { select: { hostname: true } } } }),
    db.$queryRaw<CustomerSearchRow[]>(Prisma.sql`
      SELECT
        SUBSTRING(MD5(payment."merchantId" || ':' || LOWER(BTRIM(payment."customerEmail"))) FROM 1 FOR 24) AS "customerKey",
        payment."merchantId",
        merchant."businessName" AS "merchantName",
        LOWER(BTRIM(payment."customerEmail")) AS email,
        (ARRAY_AGG(NULLIF(BTRIM(payment."customerName"), '') ORDER BY payment."createdAt" DESC)
          FILTER (WHERE NULLIF(BTRIM(payment."customerName"), '') IS NOT NULL))[1] AS name
      FROM "PaymentTransaction" payment
      INNER JOIN "Merchant" merchant ON merchant.id = payment."merchantId"
      WHERE payment."merchantId" IN (${Prisma.join(merchantIds)})
        AND payment."customerEmail" IS NOT NULL
        AND (payment."customerEmail" ILIKE ${`%${query}%`} OR COALESCE(payment."customerName", '') ILIKE ${`%${query}%`})
      GROUP BY payment."merchantId", merchant."businessName", LOWER(BTRIM(payment."customerEmail"))
      ORDER BY MAX(payment."createdAt") DESC
      LIMIT 6
    `),
  ]);

  return [
    ...customers.map((customer): GlobalSearchResult => ({ id: `customer:${customer.customerKey}`, kind: "customer", label: customer.name ?? customer.email, description: `${customer.email} · ${customer.merchantName}`, href: `/dashboard/customers/${customer.customerKey}` })),
    ...payments.map((payment): GlobalSearchResult => ({ id: `payment:${payment.id}`, kind: "payment", label: payment.publicPaymentId ?? payment.id, description: `${payment.merchant.businessName} · ${payment.currency} ${(payment.amountMinor / 100).toFixed(2)} · ${payment.status}`, href: `/dashboard/payments/${encodeURIComponent(payment.publicPaymentId ?? payment.id)}`, merchantId: payment.merchantId })),
    ...statements.map((statement): GlobalSearchResult => ({ id: `statement:${statement.id}`, kind: "statement", label: statement.publicId, description: `${statement.merchant.businessName} · ${statement.periodStart.toISOString().slice(0, 7)}`, href: `/dashboard/statements/${encodeURIComponent(statement.publicId)}`, merchantId: statement.merchantId })),
    ...scans.map((scan): GlobalSearchResult => ({ id: `scan:${scan.id}`, kind: "scan", label: scan.site.hostname, description: `${scan.merchant.businessName} · ${scan.status}`, href: `/dashboard/scans/${encodeURIComponent(scan.id)}`, merchantId: scan.merchantId })),
    ...merchants.map((merchant): GlobalSearchResult => ({ id: `merchant:${merchant.id}`, kind: "merchant", label: merchant.businessName, description: `Merchant · ${merchant.status}`, href: "/dashboard?view=brand", merchantId: merchant.id })),
  ].slice(0, 20);
}
