import Link from "next/link";
import { ArrowRight, Building2, CheckCircle2, Clock3, CreditCard, Info, XCircle } from "lucide-react";
import { MerchantPortalLink } from "@/components/merchant-portal/merchant-portal-link";
import type { PortalPaymentRow } from "@/merchant-portal/data";
import { formatMoney, formatPortalDate } from "@/merchant-portal/format";

type Row = PortalPaymentRow & { merchantId?: string; merchantName?: string };

function PaymentResult({ payment }: { payment: Row }) {
  const failed = payment.displayStatus === "Failed";
  const pending = payment.displayStatus === "Pending";
  const Icon = failed ? XCircle : pending ? Clock3 : CheckCircle2;
  return <div className="group/result relative inline-flex"><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[8px] font-semibold ${failed ? "border-[#e17b91]/20 bg-[#e17b91]/[.07] text-[#e7a0af]" : pending ? "border-[#d4ae68]/20 bg-[#d4ae68]/[.07] text-[#d7b978]" : "border-[#5bd1a4]/20 bg-[#5bd1a4]/[.07] text-[#7edab7]"}`}><Icon className="size-3" />{payment.displayStatus}</span>{failed && payment.failureReason && <div role="tooltip" className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-40 w-56 -translate-x-1/2 rounded-xl border border-[#8f7dff]/25 bg-[#15131f] p-3 opacity-0 shadow-[0_16px_45px_rgba(0,0,0,.45)] transition group-hover/result:opacity-100"><p className="text-[9px] font-semibold text-white">{payment.failureReason}</p><p className="mt-1 text-[8px] leading-4 text-[#777d89]">Processor code: {payment.failureCode ?? "not provided"}</p></div>}</div>;
}

export function PaymentsTable({ payments, emptyText = "No payments match these filters." }: { payments: Row[]; emptyText?: string }) {
  if (!payments.length) return <div className="px-6 py-20 text-center"><span className="mx-auto grid size-12 place-items-center rounded-2xl border border-[#8f7dff]/15 bg-[#8f7dff]/[.07] text-[#9f93f5]"><CreditCard className="size-4" /></span><h2 className="mt-4 text-[14px] font-semibold text-white">No payments found</h2><p className="mt-2 text-[10px] text-[#686e79]">{emptyText}</p></div>;
  const showBrand = payments.some((payment) => payment.merchantName);
  return <div className="overflow-x-auto"><table className="w-full min-w-[1060px] border-collapse text-left"><thead><tr className="border-b border-white/[.065] bg-white/[.018]">{["Date", ...(showBrand ? ["Brand"] : []), "Customer", "Payment method", "Amount", "Result", "ORBIT fee", ""].map((column) => <th key={column} className="px-5 py-3 text-[8px] font-semibold uppercase tracking-[.13em] text-[#626874] first:pl-7 last:pr-7">{column}</th>)}</tr></thead><tbody>{payments.map((payment) => {
    const href = `/dashboard/payments/${encodeURIComponent(payment.publicId)}`;
    const method = payment.methodBrand ? `${payment.methodBrand}${payment.methodLast4 ? ` •••• ${payment.methodLast4}` : ""}` : payment.methodType ?? "Unavailable";
    const cells = [
      <div key="date"><p className="whitespace-nowrap text-[10px] text-[#a9adb6]">{formatPortalDate(payment.createdAt)}</p><p className="mt-1 font-mono text-[7px] text-[#555b67]">{payment.publicId}</p></div>,
      ...(showBrand ? [<div key="brand" className="flex items-center gap-2 text-[10px] font-medium text-[#c9cbd2]"><Building2 className="size-3 text-[#8f82ef]" />{payment.merchantName ?? "—"}</div>] : []),
      <div key="customer" className="max-w-52"><p className="truncate text-[10px] font-medium text-[#d8dae0]">{payment.customerName ?? "Customer unavailable"}</p><p className="mt-1 truncate text-[8px] text-[#6f7581]">{payment.customerEmail ?? "Email unavailable"}</p></div>,
      <div key="method"><p className="capitalize text-[10px] text-[#b9bdc6]">{method}</p><p className="mt-1 capitalize text-[8px] text-[#606672]">{payment.methodType ?? "Payment method"}</p></div>,
      <div key="amount"><p className="text-[12px] font-semibold text-white">{formatMoney(payment.amountMinor, payment.currency)}</p><p className="mt-1 text-[8px] text-[#606672]">Order #{payment.orderId}</p></div>,
      <PaymentResult key="result" payment={payment} />,
      <div key="fee"><p className="text-[10px] font-medium text-[#a99cff]">{formatMoney(payment.platformFeeMinor, payment.currency)}</p><p className="mt-1 text-[8px] text-[#606672]">Platform fee</p></div>,
    ];
    return <tr key={payment.id} className="group border-b border-white/[.055] last:border-0 transition hover:bg-[#8f7dff]/[.045]">{cells.map((content, index) => <td key={index} className="px-5 py-4 first:pl-7">{content}</td>)}<td className="px-5 py-4 pr-7">{payment.merchantId ? <MerchantPortalLink merchantId={payment.merchantId} href={href} className="inline-flex size-8 items-center justify-center rounded-lg border border-white/[.08] text-[#8f82ef] transition hover:border-[#8f7dff]/30 hover:bg-[#8f7dff]/10" aria-label={`View payment ${payment.publicId}`}><ArrowRight className="size-3.5" /></MerchantPortalLink> : <Link href={href} className="inline-flex size-8 items-center justify-center rounded-lg border border-white/[.08] text-[#8f82ef] transition hover:border-[#8f7dff]/30 hover:bg-[#8f7dff]/10" aria-label={`View payment ${payment.publicId}`}><ArrowRight className="size-3.5" /></Link>}</td></tr>;
  })}</tbody></table><div className="flex items-center gap-2 border-t border-white/[.05] px-6 py-3 text-[8px] text-[#5f6571]"><Info className="size-3 text-[#8f82ef]" />Hover a failed result to see the decline reason.</div></div>;
}
