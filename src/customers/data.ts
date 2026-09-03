import { Prisma } from "@/generated/prisma/client";
import { getDatabase } from "@/sentinel/db";

export type CustomerDirectoryInput = { query?: string; page?: number };

export type CustomerDirectoryRow = {
  merchantId: string;
  merchantName: string;
  email: string;
  name: string | null;
  paymentCount: number;
  successfulPayments: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastPaymentPublicId: string;
  lastPaymentAmountMinor: number;
  lastPaymentCurrency: string;
};

type CustomerSummary = {
  totalCustomers: number;
  newCustomers: number;
  activeCustomers: number;
  brandsRepresented: number;
};

const pageSize = 25;

const customerRollup = (merchantIds: string[]) => Prisma.sql`
  SELECT
    payment."merchantId",
    LOWER(BTRIM(payment."customerEmail")) AS email,
    (ARRAY_AGG(NULLIF(BTRIM(payment."customerName"), '') ORDER BY payment."createdAt" DESC)
      FILTER (WHERE NULLIF(BTRIM(payment."customerName"), '') IS NOT NULL))[1] AS name,
    COUNT(*)::integer AS "paymentCount",
    COUNT(*) FILTER (WHERE payment.status = 'SUCCEEDED')::integer AS "successfulPayments",
    MIN(payment."createdAt") AS "firstSeenAt",
    MAX(payment."createdAt") AS "lastSeenAt",
    (ARRAY_AGG(COALESCE(payment."publicPaymentId", payment.id) ORDER BY payment."createdAt" DESC))[1] AS "lastPaymentPublicId",
    (ARRAY_AGG(payment."amountMinor" ORDER BY payment."createdAt" DESC))[1] AS "lastPaymentAmountMinor",
    (ARRAY_AGG(payment.currency ORDER BY payment."createdAt" DESC))[1] AS "lastPaymentCurrency"
  FROM "PaymentTransaction" payment
  WHERE payment."merchantId" IN (${Prisma.join(merchantIds)})
    AND payment."customerEmail" IS NOT NULL
    AND BTRIM(payment."customerEmail") <> ''
  GROUP BY payment."merchantId", LOWER(BTRIM(payment."customerEmail"))
`;

export function customerMerchantIds(role: string, selectedMerchantId: string | null, authorizedMerchantIds: string[]) {
  if (["OWNER", "ADMIN"].includes(role)) return [...new Set(authorizedMerchantIds)];
  return selectedMerchantId ? [selectedMerchantId] : [];
}

export async function listCustomers(merchantIds: string[], input: CustomerDirectoryInput = {}) {
  if (!merchantIds.length) {
    return { rows: [] as CustomerDirectoryRow[], summary: { totalCustomers: 0, newCustomers: 0, activeCustomers: 0, brandsRepresented: 0 }, page: 1, hasPrevious: false, hasNext: false };
  }

  const query = input.query?.trim().slice(0, 120) ?? "";
  const page = Number.isInteger(input.page) && Number(input.page) > 0 ? Number(input.page) : 1;
  const offset = (page - 1) * pageSize;
  const search = query
    ? Prisma.sql`WHERE customer.email ILIKE ${`%${query}%`} OR COALESCE(customer.name, '') ILIKE ${`%${query}%`} OR merchant."businessName" ILIKE ${`%${query}%`}`
    : Prisma.empty;
  const activeSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000);
  const db = getDatabase();

  const [rawRows, summaries] = await Promise.all([
    db.$queryRaw<CustomerDirectoryRow[]>(Prisma.sql`
      WITH customer AS (${customerRollup(merchantIds)})
      SELECT
        customer."merchantId",
        merchant."businessName" AS "merchantName",
        customer.email,
        customer.name,
        customer."paymentCount",
        customer."successfulPayments",
        customer."firstSeenAt",
        customer."lastSeenAt",
        customer."lastPaymentPublicId",
        customer."lastPaymentAmountMinor",
        customer."lastPaymentCurrency"
      FROM customer
      INNER JOIN "Merchant" merchant ON merchant.id = customer."merchantId"
      ${search}
      ORDER BY customer."lastSeenAt" DESC, customer.email ASC
      LIMIT ${pageSize + 1} OFFSET ${offset}
    `),
    db.$queryRaw<CustomerSummary[]>(Prisma.sql`
      WITH customer AS (${customerRollup(merchantIds)})
      SELECT
        COUNT(*)::integer AS "totalCustomers",
        COUNT(*) FILTER (WHERE customer."firstSeenAt" >= ${activeSince})::integer AS "newCustomers",
        COUNT(*) FILTER (WHERE customer."lastSeenAt" >= ${activeSince})::integer AS "activeCustomers",
        COUNT(DISTINCT customer."merchantId")::integer AS "brandsRepresented"
      FROM customer
    `),
  ]);

  const hasNext = rawRows.length > pageSize;
  return {
    rows: hasNext ? rawRows.slice(0, pageSize) : rawRows,
    summary: summaries[0] ?? { totalCustomers: 0, newCustomers: 0, activeCustomers: 0, brandsRepresented: 0 },
    page,
    hasPrevious: page > 1,
    hasNext,
  };
}
