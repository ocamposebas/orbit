import { Prisma } from "@/generated/prisma/client";
import { getDatabase } from "@/sentinel/db";

export type CustomerDirectoryInput = { query?: string; page?: number };

export type CustomerDirectoryRow = {
  customerKey: string;
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
    SUBSTRING(MD5(payment."merchantId" || ':' || LOWER(BTRIM(payment."customerEmail"))) FROM 1 FOR 24) AS "customerKey",
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

export type CustomerPayment = {
  id: string;
  publicId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  status: string;
  source: string;
  createdAt: Date;
};

export type CustomerCurrencyTotal = { currency: string; amountMinor: number; successfulPayments: number };

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
        customer."customerKey",
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

export async function getCustomerDetail(merchantIds: string[], customerKey: string) {
  if (!merchantIds.length || !/^[a-f0-9]{24}$/.test(customerKey)) return null;
  const db = getDatabase();
  const customers = await db.$queryRaw<CustomerDirectoryRow[]>(Prisma.sql`
    WITH customer AS (${customerRollup(merchantIds)})
    SELECT
      customer."customerKey",
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
    WHERE customer."customerKey" = ${customerKey}
    LIMIT 1
  `);
  const customer = customers[0];
  if (!customer) return null;

  const [transactions, totals] = await Promise.all([
    db.paymentTransaction.findMany({
      where: { merchantId: customer.merchantId, customerEmail: { equals: customer.email, mode: "insensitive" } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      select: { id: true, publicPaymentId: true, wooOrderId: true, amountMinor: true, currency: true, status: true, source: true, createdAt: true },
    }),
    db.$queryRaw<CustomerCurrencyTotal[]>(Prisma.sql`
      SELECT
        payment.currency,
        COALESCE(SUM(payment."amountMinor") FILTER (WHERE payment.status = 'SUCCEEDED'), 0)::double precision AS "amountMinor",
        COUNT(*) FILTER (WHERE payment.status = 'SUCCEEDED')::integer AS "successfulPayments"
      FROM "PaymentTransaction" payment
      WHERE payment."merchantId" = ${customer.merchantId}
        AND LOWER(BTRIM(payment."customerEmail")) = ${customer.email}
      GROUP BY payment.currency
      ORDER BY payment.currency
    `),
  ]);

  const payments: CustomerPayment[] = transactions.map((payment) => ({
    id: payment.id,
    publicId: payment.publicPaymentId ?? payment.id,
    orderId: payment.wooOrderId,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    status: payment.status,
    source: payment.source,
    createdAt: payment.createdAt,
  }));
  return { customer, payments, totals };
}

export async function exportCustomers(merchantIds: string[], query = "") {
  if (!merchantIds.length) return [] as CustomerDirectoryRow[];
  const normalized = query.trim().slice(0, 120);
  const search = normalized
    ? Prisma.sql`WHERE customer.email ILIKE ${`%${normalized}%`} OR COALESCE(customer.name, '') ILIKE ${`%${normalized}%`} OR merchant."businessName" ILIKE ${`%${normalized}%`}`
    : Prisma.empty;
  return getDatabase().$queryRaw<CustomerDirectoryRow[]>(Prisma.sql`
    WITH customer AS (${customerRollup(merchantIds)})
    SELECT customer."customerKey", customer."merchantId", merchant."businessName" AS "merchantName",
      customer.email, customer.name, customer."paymentCount", customer."successfulPayments",
      customer."firstSeenAt", customer."lastSeenAt", customer."lastPaymentPublicId",
      customer."lastPaymentAmountMinor", customer."lastPaymentCurrency"
    FROM customer INNER JOIN "Merchant" merchant ON merchant.id = customer."merchantId"
    ${search}
    ORDER BY customer."lastSeenAt" DESC, customer.email ASC
    LIMIT 5000
  `);
}
