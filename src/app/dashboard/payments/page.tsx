import Link from "next/link";
import { ArrowLeft, ArrowRight, CreditCard } from "lucide-react";
import { PaymentFilters } from "@/components/merchant-portal/payment-filters";
import { MerchantPortalLink } from "@/components/merchant-portal/merchant-portal-link";
import { StatusPill } from "@/components/merchant-portal/status-pill";
import { getPortalContext } from "@/merchant-portal/access";
import { getAdminPayments, getMerchantPayments, type PaymentListInput } from "@/merchant-portal/data";
import { formatMoney, formatPortalDate } from "@/merchant-portal/format";

type Query = { [key: string]: string | string[] | undefined };
const textValue = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;

function paginationHref(query: Query, cursor: string, direction: "next" | "prev") {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (typeof value === "string" && !["cursor", "direction"].includes(key)) params.set(key, value);
  params.set("cursor", cursor);
  params.set("direction", direction);
  return `/dashboard/payments?${params.toString()}`;
}

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const [{ merchant, merchants, session }, query] = await Promise.all([getPortalContext(), searchParams]);
  const input: PaymentListInput = {
    query: textValue(query.query), status: textValue(query.status), range: textValue(query.range), from: textValue(query.from), to: textValue(query.to), cursor: textValue(query.cursor), direction: textValue(query.direction) === "prev" ? "prev" : "next",
  };
  const isAdminPortfolio = ["OWNER", "ADMIN"].includes(session.role) && !textValue(query.merchant);
  if (isAdminPortfolio) {
    const result = await getAdminPayments(merchants.map((item) => item.id), input);
    return <div className="mx-auto w-full max-w-[1540px] px-4 py-7 sm:px-7 lg:px-10 lg:py-10">
      <header><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#9182f0]">Private admin portfolio</p><h1 className="mt-2 text-[28px] font-semibold tracking-[-.055em] text-white sm:text-[34px]">All payments</h1><p className="mt-2 text-[12px] text-[#777c88]">Every payment across every ORBIT brand. Open one to inspect its full ORBIT Payment detail.</p></header>
      <section className="mt-7 overflow-hidden rounded-[20px] border border-white/[.075] bg-[#0c0e14]"><PaymentFilters values={input} />{result.payments.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1120px] border-collapse text-left"><thead><tr className="border-b border-white/[.06] bg-white/[.015]">{["Date", "Brand", "Payment", "Order", "Customer", "Gross", "ORBIT revenue", "After ORBIT fee", "Status", ""].map((column) => <th key={column} className="px-4 py-3 text-[8px] font-semibold uppercase tracking-[.13em] text-[#666b77] first:pl-6 last:pr-6">{column}</th>)}</tr></thead><tbody>{result.payments.map((payment) => <tr key={payment.id} className="border-b border-white/[.055] last:border-0 hover:bg-white/[.02]"><td className="px-6 py-4 text-[10px] text-[#7d828d]">{formatPortalDate(payment.createdAt)}</td><td className="px-4 py-4 text-[10px] font-medium text-[#dadce1]">{payment.merchantName}</td><td className="px-4 py-4 font-mono text-[9px] text-[#9b8cff]">{payment.publicId}</td><td className="px-4 py-4 text-[10px] text-[#8b909b]">#{payment.orderId}</td><td className="max-w-40 truncate px-4 py-4 text-[10px] text-[#777c88]">{payment.customerEmail ?? "—"}</td><td className="px-4 py-4 text-[10px] font-semibold text-white">{formatMoney(payment.amountMinor, payment.currency)}</td><td className="px-4 py-4 text-[10px] text-[#a99eff]">{formatMoney(payment.platformFeeMinor, payment.currency)}</td><td className="px-4 py-4 text-[10px] text-[#b8bbc3]">{formatMoney(payment.merchantAfterOrbitFeeMinor, payment.currency)}</td><td className="px-4 py-4"><StatusPill status={payment.status} /></td><td className="px-4 py-4"><MerchantPortalLink merchantId={payment.merchantId} href={`/dashboard/payments/${encodeURIComponent(payment.publicId)}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/[.08] px-3 text-[9px] text-[#a99eff]">View <ArrowRight className="size-3" /></MerchantPortalLink></td></tr>)}</tbody></table></div> : <div className="px-6 py-20 text-center text-[11px] text-[#6c717d]">No payments match these filters.</div>}{(result.previousCursor || result.nextCursor) && <div className="flex items-center justify-between border-t border-white/[.06] px-5 py-4"><div>{result.previousCursor && <Link href={paginationHref(query, result.previousCursor, "prev")} className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-white/[.08] px-3.5 text-[10px] text-[#aaaeb7]"><ArrowLeft className="size-3.5" />Previous</Link>}</div><div>{result.nextCursor && <Link href={paginationHref(query, result.nextCursor, "next")} className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-white/[.08] px-3.5 text-[10px] text-[#aaaeb7]">Next<ArrowRight className="size-3.5" /></Link>}</div></div>}</section>
    </div>;
  }
  const requestedMerchantId = textValue(query.merchant);
  const selectedMerchant = requestedMerchantId && ["OWNER", "ADMIN"].includes(session.role) ? merchants.find((item) => item.id === requestedMerchantId) ?? merchant : merchant;
  if (!selectedMerchant) return null;
  const result = await getMerchantPayments(selectedMerchant.id, input);

  return <div className="mx-auto w-full max-w-[1480px] px-4 py-7 sm:px-7 lg:px-10 lg:py-10">
    <header><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#8e929a]">Transactions</p><h1 className="mt-2 text-[28px] font-semibold tracking-[-.055em] text-[#181a1e] sm:text-[34px]">Payments</h1><p className="mt-2 text-[12px] text-[#7d8189]">Every ORBIT payment, with fees and what you keep.</p></header>
    {!result.processorAvailable && <p className="mt-5 rounded-xl border border-[#e6e1c9] bg-[#fbf8e9] px-4 py-3 text-[10px] leading-5 text-[#7b6c3d]">Processing fees, payment methods, refunds and disputes appear when ORBIT Payment data is available. Recorded amounts and platform fees remain visible.</p>}
    <section className="mt-7 overflow-hidden rounded-[20px] border border-[#dfe1e5] bg-white shadow-[0_12px_40px_rgba(29,34,44,.04)]">
      <PaymentFilters values={input} />
      {result.payments.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1180px] border-collapse text-left"><thead><tr className="border-b border-[#e9eaed] bg-[#fafbfc]">{["Date", "Payment", "Order", "Customer", "Payment method", "Gross", "ORBIT fee", "Processing fee", "Net", "Status"].map((column) => <th key={column} className="px-4 py-3 text-[8px] font-semibold uppercase tracking-[.13em] text-[#999da5] first:pl-6 last:pr-6">{column}</th>)}</tr></thead><tbody>{result.payments.map((payment) => {
        const href = `/dashboard/payments/${encodeURIComponent(payment.publicId)}`;
        const method = payment.methodBrand ? `${payment.methodBrand.charAt(0).toUpperCase()}${payment.methodBrand.slice(1)}${payment.methodLast4 ? ` •••• ${payment.methodLast4}` : ""}` : "—";
        return <tr key={payment.id} className="group border-b border-[#eef0f2] last:border-0 hover:bg-[#fafaff]">{[
          <span key="date" className="whitespace-nowrap text-[#50545b]">{formatPortalDate(payment.createdAt)}</span>,
          <span key="payment" className="font-mono text-[9px] text-[#6254ca]">{payment.publicId}</span>,
          <span key="order" className="text-[#34373d]">#{payment.orderId}</span>,
          <span key="customer" className="block max-w-40 truncate text-[#6e727a]">{payment.customerEmail ?? "—"}</span>,
          <span key="method" className="capitalize text-[#6e727a]">{method}</span>,
          <span key="gross" className="font-medium text-[#34373d]">{formatMoney(payment.amountMinor, payment.currency)}</span>,
          <span key="orbit" className="text-[#8b5662]">-{formatMoney(payment.platformFeeMinor, payment.currency)}</span>,
          <span key="processing" className="text-[#8b5662]">{payment.processingFeeMinor === null ? "—" : `-${formatMoney(payment.processingFeeMinor, payment.currency)}`}</span>,
          <span key="net" className="font-medium text-[#34373d]">{payment.netMinor === null ? "—" : formatMoney(payment.netMinor, payment.currency)}</span>,
          <StatusPill key="status" status={payment.displayStatus} />,
        ].map((content, index) => <td key={index} className="p-0 text-[10px] first:pl-2 last:pr-2"><Link href={href} className="block min-h-14 px-2 py-5 first:pl-4" aria-label={index === 0 ? `Open payment ${payment.publicId}` : undefined}>{content}</Link></td>)}</tr>;
      })}</tbody></table></div> : <div className="px-6 py-20 text-center"><span className="mx-auto grid size-11 place-items-center rounded-xl bg-[#f0edff] text-[#7769df]"><CreditCard className="size-4" /></span><h2 className="mt-4 text-[15px] font-semibold text-[#34373d]">No payments found</h2><p className="mx-auto mt-2 max-w-sm text-[11px] leading-5 text-[#8b8f97]">Payments will appear here as soon as transactions matching these filters are processed through ORBIT.</p></div>}
      {(result.previousCursor || result.nextCursor) && <div className="flex items-center justify-between border-t border-[#e9eaed] px-5 py-4"><div>{result.previousCursor && <Link href={paginationHref(query, result.previousCursor, "prev")} className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#dfe1e5] px-3.5 text-[10px] font-medium text-[#5f636b]"><ArrowLeft className="size-3.5" />Previous</Link>}</div><div>{result.nextCursor && <Link href={paginationHref(query, result.nextCursor, "next")} className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#dfe1e5] px-3.5 text-[10px] font-medium text-[#5f636b]">Next<ArrowRight className="size-3.5" /></Link>}</div></div>}
    </section>
  </div>;
}
