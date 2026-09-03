import { getDatabase } from "@/sentinel/db";

export type PortalActivityItem = {
  id: string;
  kind: "payment" | "statement" | "scan" | "alert" | "integration";
  merchantId: string;
  merchantName: string;
  title: string;
  description: string;
  status: string;
  occurredAt: Date;
  href: string;
};

export async function getPortalActivity(merchantIds: string[]) {
  if (!merchantIds.length) return [] as PortalActivityItem[];
  const db = getDatabase();
  const [payments, statements, scans, alerts, stripeEvents] = await Promise.all([
    db.paymentTransaction.findMany({
      where: { merchantId: { in: merchantIds } }, orderBy: { createdAt: "desc" }, take: 25,
      include: { merchant: { select: { businessName: true } } },
    }),
    db.merchantStatement.findMany({
      where: { merchantId: { in: merchantIds } }, orderBy: { updatedAt: "desc" }, take: 20,
      include: { merchant: { select: { businessName: true } } },
    }),
    db.scan.findMany({
      where: { merchantId: { in: merchantIds } }, orderBy: { updatedAt: "desc" }, take: 20,
      include: { merchant: { select: { businessName: true } }, site: { select: { hostname: true } } },
    }),
    db.alert.findMany({
      where: { merchantId: { in: merchantIds } }, orderBy: { createdAt: "desc" }, take: 20,
      include: { merchant: { select: { businessName: true } } },
    }),
    db.stripeConnectEvent.findMany({
      where: { integration: { merchantId: { in: merchantIds } } }, orderBy: { createdAt: "desc" }, take: 20,
      include: { integration: { include: { merchant: { select: { id: true, businessName: true } } } } },
    }),
  ]);
  return [
    ...payments.map((item): PortalActivityItem => ({ id: `payment:${item.id}`, kind: "payment", merchantId: item.merchantId, merchantName: item.merchant.businessName, title: item.status === "SUCCEEDED" ? "Payment succeeded" : `Payment ${item.status.toLowerCase().replaceAll("_", " ")}`, description: `${item.publicPaymentId ?? item.id} · ${item.currency} ${(item.amountMinor / 100).toFixed(2)}`, status: item.status, occurredAt: item.updatedAt, href: `/dashboard/payments/${encodeURIComponent(item.publicPaymentId ?? item.id)}` })),
    ...statements.map((item): PortalActivityItem => ({ id: `statement:${item.id}`, kind: "statement", merchantId: item.merchantId, merchantName: item.merchant.businessName, title: `Statement ${item.status.toLowerCase().replaceAll("_", " ")}`, description: `${item.publicId} · Email ${item.emailStatus.toLowerCase()}`, status: item.emailStatus, occurredAt: item.updatedAt, href: `/dashboard/statements/${encodeURIComponent(item.publicId)}` })),
    ...scans.map((item): PortalActivityItem => ({ id: `scan:${item.id}`, kind: "scan", merchantId: item.merchantId, merchantName: item.merchant.businessName, title: `Compliance scan ${item.status.toLowerCase().replaceAll("_", " ")}`, description: `${item.site.hostname} · ${item.findingsCreated} findings`, status: item.status, occurredAt: item.updatedAt, href: `/dashboard/scans/${encodeURIComponent(item.id)}` })),
    ...alerts.map((item): PortalActivityItem => ({ id: `alert:${item.id}`, kind: "alert", merchantId: item.merchantId, merchantName: item.merchant.businessName, title: item.title, description: "Compliance alert", status: item.status, occurredAt: item.createdAt, href: "/dashboard/health" })),
    ...stripeEvents.map((item): PortalActivityItem => ({ id: `integration:${item.id}`, kind: "integration", merchantId: item.integration!.merchant.id, merchantName: item.integration!.merchant.businessName, title: "Stripe account event", description: item.type, status: item.status, occurredAt: item.createdAt, href: "/dashboard/health" })),
  ].sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime()).slice(0, 60);
}
