import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarDays, CreditCard, Mail, ReceiptText, ShieldCheck, Store, UsersRound } from "lucide-react";
import { notFound } from "next/navigation";
import { MerchantPortalLink } from "@/components/merchant-portal/merchant-portal-link";
import { customerMerchantIds, getCustomerDetail } from "@/customers/data";
import { getPortalContext } from "@/merchant-portal/access";
import { getMerchantPayments } from "@/merchant-portal/data";
import { formatMoney, formatPortalDate, formatPortalDateTime, paymentStatusLabel } from "@/merchant-portal/format";

export default async function CustomerDetailPage({ params }: { params: Promise<{ customerKey: string }> }) {
  const [{ merchant, merchants, session }, route] = await Promise.all([getPortalContext(), params]);
  const portfolio = ["OWNER", "ADMIN"].includes(session.role);
  const merchantIds = customerMerchantIds(session.role, merchant?.id ?? null, merchants.map((item) => item.id));
  const detail = await getCustomerDetail(merchantIds, route.customerKey);
  if (!detail) notFound();
  const { customer, payments, totals } = detail;
  const livePayments = await getMerchantPayments(customer.merchantId, { query: customer.email, range: "all" });
  const liveById = new Map(livePayments.payments.map((payment) => [payment.id, payment]));
  const initials = (customer.name ?? customer.email).split(/\s+|@/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  return <div className="mx-auto w-full max-w-[1320px] px-4 py-7 sm:px-7 lg:px-10 lg:py-10">
    <Link href="/dashboard/customers" className="inline-flex items-center gap-2 text-[10px] font-medium text-[#8d83db] hover:text-[#b5adfa]"><ArrowLeft className="size-3.5" />Customers</Link>
    <header className="mt-6 overflow-hidden rounded-[26px] border border-white/[.08] bg-[#0b0d13]"><div className="h-1 bg-gradient-to-r from-[#7158ef] via-[#9277ff] to-[#62cda8]" /><div className="flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-end lg:justify-between"><div className="flex items-start gap-4"><span className="grid size-14 shrink-0 place-items-center rounded-2xl border border-[#8f7dff]/20 bg-[#8f7dff]/10 text-[15px] font-semibold text-[#b8affb]">{initials}</span><div><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-[#777d89]">Customer profile</p><h1 className="mt-2 text-[28px] font-semibold tracking-[-.05em] text-white sm:text-[36px]">{customer.name ?? "Customer"}</h1><p className="mt-2 flex items-center gap-2 text-[10px] text-[#8b909b]"><Mail className="size-3.5 text-[#9182f0]" />{customer.email}</p></div></div><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-white/[.07] bg-white/[.02] px-4 py-3"><p className="text-[8px] uppercase tracking-[.1em] text-[#626874]">Merchant</p><p className="mt-1.5 text-[10px] font-medium text-[#d6d8de]">{customer.merchantName}</p></div><div className="rounded-xl border border-white/[.07] bg-white/[.02] px-4 py-3"><p className="text-[8px] uppercase tracking-[.1em] text-[#626874]">First seen</p><p className="mt-1.5 text-[10px] font-medium text-[#d6d8de]">{formatPortalDate(customer.firstSeenAt)}</p></div><div className="rounded-xl border border-white/[.07] bg-white/[.02] px-4 py-3"><p className="text-[8px] uppercase tracking-[.1em] text-[#626874]">Last activity</p><p className="mt-1.5 text-[10px] font-medium text-[#d6d8de]">{formatPortalDate(customer.lastSeenAt)}</p></div></div></div></header>

    <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><article className="rounded-[20px] border border-white/[.075] bg-[#0b0d13] p-5"><UsersRound className="size-4 text-[#9182f0]" /><p className="mt-5 text-[26px] font-semibold text-white">{customer.paymentCount}</p><p className="mt-1 text-[9px] uppercase tracking-[.11em] text-[#6e7480]">Payment attempts</p></article><article className="rounded-[20px] border border-white/[.075] bg-[#0b0d13] p-5"><ShieldCheck className="size-4 text-[#63caa5]" /><p className="mt-5 text-[26px] font-semibold text-white">{customer.successfulPayments}</p><p className="mt-1 text-[9px] uppercase tracking-[.11em] text-[#6e7480]">Successful payments</p></article>{totals.slice(0, 2).map((total) => <article key={total.currency} className="rounded-[20px] border border-white/[.075] bg-[#0b0d13] p-5"><CreditCard className="size-4 text-[#9182f0]" /><p className="mt-5 text-[22px] font-semibold text-white">{formatMoney(total.amountMinor, total.currency)}</p><p className="mt-1 text-[9px] uppercase tracking-[.11em] text-[#6e7480]">Successful volume · {total.currency}</p></article>)}</section>

    <section className="mt-5 overflow-hidden rounded-[24px] border border-white/[.075] bg-[#0b0d13]"><div className="flex items-center justify-between border-b border-white/[.07] px-5 py-5 sm:px-7"><div><p className="text-[9px] font-semibold uppercase tracking-[.12em] text-[#777d89]">Timeline</p><h2 className="mt-2 text-[18px] font-semibold text-white">Payment history</h2></div><span className="flex items-center gap-2 text-[8px] text-[#676d78]"><Store className="size-3.5" />{customer.merchantName}</span></div>
      {payments.length ? <div>{payments.map((payment) => {
        const href = `/dashboard/payments/${encodeURIComponent(payment.publicId)}`;
        const live = liveById.get(payment.id);
        const method = live?.methodBrand ? `${live.methodBrand}${live.methodLast4 ? ` ···· ${live.methodLast4}` : ""}` : live?.methodType ?? payment.source.toLowerCase();
        const content = <><span className="grid size-9 place-items-center rounded-xl bg-[#8f7dff]/[.07] text-[#988af1]"><ReceiptText className="size-3.5" /></span><span><span className="block text-[11px] font-medium text-[#dfe1e6]">Order #{payment.orderId}</span><span className="mt-1 flex items-center gap-1.5 text-[8px] text-[#686e79]"><CalendarDays className="size-3" />{formatPortalDateTime(payment.createdAt)} UTC · {method}</span></span><span className="text-[9px] text-[#858b96]">{paymentStatusLabel(payment.status)}</span><span className="text-right text-[11px] font-semibold tabular-nums text-white">{formatMoney(payment.amountMinor, payment.currency)}</span><ArrowRight className="size-3.5 text-[#646a76]" /></>;
        const className = "grid w-full grid-cols-[36px_1fr_auto_auto_16px] items-center gap-3 border-b border-white/[.055] px-5 py-4 text-left last:border-0 hover:bg-[#8f7dff]/[.025] sm:px-7";
        return portfolio ? <MerchantPortalLink key={payment.id} merchantId={customer.merchantId} href={href} className={className}>{content}</MerchantPortalLink> : <Link key={payment.id} href={href} className={className}>{content}</Link>;
      })}</div> : <div className="px-6 py-16 text-center text-[10px] text-[#6d727d]">No payment activity is available for this customer.</div>}
      {payments.length === 100 && <p className="border-t border-white/[.06] px-7 py-4 text-[8px] text-[#636975]">Showing the 100 most recent payment attempts.</p>}
    </section>
  </div>;
}
