import { NextResponse, type NextRequest } from "next/server";
import { customerMerchantIds, exportCustomers } from "@/customers/data";
import { getPortalContext } from "@/merchant-portal/access";

const csv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

export async function GET(request: NextRequest) {
  const { merchant, merchants, session } = await getPortalContext();
  const scope = customerMerchantIds(session.role, merchant?.id ?? null, merchants.map((item) => item.id));
  const rows = await exportCustomers(scope, request.nextUrl.searchParams.get("query") ?? "");
  const headings = ["Customer name", "Customer email", "Merchant", "Successful payments", "Payment attempts", "First seen UTC", "Last activity UTC", "Last payment ID"];
  const body = [headings, ...rows.map((row) => [row.name, row.email, row.merchantName, row.successfulPayments, row.paymentCount, row.firstSeenAt.toISOString(), row.lastSeenAt.toISOString(), row.lastPaymentPublicId])].map((row) => row.map(csv).join(",")).join("\r\n");
  return new NextResponse(`\uFEFF${body}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="orbit-customers-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
