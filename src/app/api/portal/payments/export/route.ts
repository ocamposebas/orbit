import { NextResponse, type NextRequest } from "next/server";
import { getPortalContext } from "@/merchant-portal/access";
import { getDatabase } from "@/sentinel/db";

const csv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const statusGroups = {
  succeeded: ["SUCCEEDED"], pending: ["CREATED", "REQUIRES_PAYMENT", "PROCESSING"], failed: ["FAILED", "CANCELED"],
  refunded: ["SUCCEEDED"], partially_refunded: ["SUCCEEDED"], disputed: ["SUCCEEDED"],
} as const;

export async function GET(request: NextRequest) {
  const { merchant, merchants, session } = await getPortalContext();
  const requestedMerchant = request.nextUrl.searchParams.get("merchant");
  const admin = ["OWNER", "ADMIN"].includes(session.role);
  const merchantIds = admin && !requestedMerchant
    ? merchants.map((item) => item.id)
    : [admin && requestedMerchant && merchants.some((item) => item.id === requestedMerchant) ? requestedMerchant : merchant?.id].filter((id): id is string => Boolean(id));
  const statusInput = request.nextUrl.searchParams.get("status")?.toLowerCase();
  const statuses = statusInput && statusInput in statusGroups ? statusGroups[statusInput as keyof typeof statusGroups] : undefined;
  const query = request.nextUrl.searchParams.get("query")?.trim().slice(0, 120);
  const fromInput = request.nextUrl.searchParams.get("from");
  const toInput = request.nextUrl.searchParams.get("to");
  let from = fromInput && /^\d{4}-\d{2}-\d{2}$/.test(fromInput) ? new Date(`${fromInput}T00:00:00.000Z`) : undefined;
  let to = toInput && /^\d{4}-\d{2}-\d{2}$/.test(toInput) ? new Date(`${toInput}T23:59:59.999Z`) : undefined;
  const range = request.nextUrl.searchParams.get("range");
  if (!from && !to && range && ["today", "7d", "30d", "90d"].includes(range)) {
    to = new Date();
    const days = range === "today" ? 1 : Number(range.slice(0, -1));
    from = new Date(to.getTime() - days * 86_400_000);
  }
  const contains = query ? { contains: query, mode: "insensitive" as const } : undefined;
  const payments = await getDatabase().paymentTransaction.findMany({
    where: { merchantId: { in: merchantIds }, ...(statuses ? { status: { in: [...statuses] } } : {}), ...((from || to) ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}), ...(contains ? { OR: [{ publicPaymentId: contains }, { wooOrderId: contains }, { stripePaymentIntentId: contains }, { customerEmail: contains }, { customerName: contains }] } : {}) },
    orderBy: { createdAt: "desc" }, take: 5_000, include: { merchant: { select: { businessName: true } } },
  });
  const headings = ["Payment ID", "Merchant", "Created UTC", "Status", "Amount minor", "Currency", "Customer name", "Customer email", "Order", "Source", "Processor reference"];
  const body = [headings, ...payments.map((payment) => [payment.publicPaymentId ?? payment.id, payment.merchant.businessName, payment.createdAt.toISOString(), payment.status, payment.amountMinor, payment.currency, payment.customerName, payment.customerEmail, payment.wooOrderId, payment.source, payment.stripePaymentIntentId])].map((row) => row.map(csv).join(",")).join("\r\n");
  return new NextResponse(`\uFEFF${body}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="orbit-payments-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
