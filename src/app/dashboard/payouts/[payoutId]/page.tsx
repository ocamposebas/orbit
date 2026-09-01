import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Building2, CalendarClock, CreditCard, Landmark, ReceiptText } from "lucide-react";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/merchant-portal/copy-button";
import { StatusPill } from "@/components/merchant-portal/status-pill";
import { getPortalContext } from "@/merchant-portal/access";
import { getMerchantPayout } from "@/merchant-portal/data";
import { formatMoney, formatPortalDate, formatPortalDateTime, payoutStatusLabel } from "@/merchant-portal/format";

export const metadata: Metadata = { title: "Transfer details", robots: { index: false, follow: false } };

export default async function PayoutDetailPage({ params, searchParams }: { params: Promise<{ payoutId: string }>; searchParams: Promise<{ cursor?: string | string[] }> }) {
  const [{ merchant }, { payoutId }, query] = await Promise.all([getPortalContext(), params, searchParams]);
  if (!merchant) notFound();
  const cursor = typeof query.cursor === "string" ? query.cursor : undefined;
  const payout = await getMerchantPayout(merchant.id, payoutId, cursor);
  if (!payout) notFound();

  return <div className="mx-auto w-full max-w-[1240px] px-4 py-7 sm:px-7 lg:px-10 lg:py-10">
    <Link href="/dashboard/payouts" className="inline-flex items-center gap-1.5 text-[10px] font-medium text-[#7c8088] hover:text-white"><ArrowLeft className="size-3.5" />Transfers</Link>
    <header className="mt-6 flex flex-col gap-5 border-b border-[#dfe1e5] pb-7 sm:flex-row sm:items-end sm:justify-between"><div><div className="flex items-center gap-3"><h1 className="text-[36px] font-semibold tracking-[-.055em] tabular-nums text-[#191b20] sm:text-[44px]">{formatMoney(payout.amountMinor, payout.currency)}</h1><StatusPill status={payoutStatusLabel(payout.status)} /></div><p className="mt-3 font-mono text-[10px] text-[#696d75]">{payout.id}</p></div><CopyButton value={payout.id} label="Copy transfer ID" /></header>

    <section className="mt-8 grid gap-4 md:grid-cols-3"><Summary icon={<CalendarClock className="size-4" />} label="Arrival" value={formatPortalDate(payout.arrivalDate)} /><Summary icon={<Building2 className="size-4" />} label="Destination" value={payout.destination} /><Summary icon={<ReceiptText className="size-4" />} label="Created" value={formatPortalDate(payout.created)} /></section>

    {payout.failureMessage && <p className="mt-6 rounded-xl border border-[#f0d9de] bg-[#fff0f3] px-4 py-3 text-[10px] leading-5 text-[#9c4e5f]">{payout.failureMessage}</p>}

    <div className="mt-8 grid gap-6 lg:grid-cols-[.75fr_1.25fr]">
      <section className="rounded-[20px] border border-[#dfe1e5] bg-white p-6 sm:p-7"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#979ba3]">Transfer timeline</p><div className="mt-6"><TimelineItem label="Transfer created" date={payout.created} detail="ORBIT Payment transfer created" /><TimelineItem label="Expected arrival" date={payout.arrivalDate} detail="Estimated by ORBIT Payment" last /></div><div className="mt-4 border-t border-[#eceef0] pt-4"><p className="text-[9px] text-[#999da5]">Current status</p><div className="mt-2"><StatusPill status={payoutStatusLabel(payout.status)} /></div>{payout.traceId && <div className="mt-4 flex items-center justify-between gap-3"><span className="text-[9px] text-[#999da5]">Bank trace reference</span><CopyButton value={payout.traceId} label="Copy" /></div>}</div></section>

      <section className="overflow-hidden rounded-[20px] border border-[#dfe1e5] bg-white"><div className="border-b border-[#e8e9ec] px-5 py-5 sm:px-7"><div className="flex items-center gap-2"><CreditCard className="size-4 text-[#7668dc]" /><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#979ba3]">Payments included</p></div><h2 className="mt-2 text-[18px] font-semibold tracking-[-.035em] text-[#202329]">Transfer composition</h2></div>{payout.payments.length ? <div>{payout.payments.map((payment) => <Link key={payment.id} href={`/dashboard/payments/${encodeURIComponent(payment.publicId)}`} className="grid grid-cols-[1fr_auto_18px] items-center gap-3 border-b border-[#eef0f2] px-5 py-4 last:border-0 hover:bg-[#fafaff] sm:px-7"><div><p className="text-[11px] font-medium text-[#34373d]">Order #{payment.orderId}</p><p className="mt-1 font-mono text-[8px] text-[#999da5]">{payment.publicId}</p></div><p className="text-[11px] font-semibold tabular-nums text-[#34373d]">{formatMoney(payment.amountMinor, payment.currency)}</p><ArrowRight className="size-3.5 text-[#b2b5bb]" /></Link>)}</div> : <div className="px-6 py-16 text-center"><span className="mx-auto grid size-10 place-items-center rounded-xl bg-[#f0edff] text-[#7769df]"><Landmark className="size-4" /></span><h3 className="mt-4 text-[14px] font-semibold text-[#34373d]">No matched ORBIT payments</h3><p className="mx-auto mt-2 max-w-sm text-[10px] leading-5 text-[#8b8f97]">Payments appear after ORBIT Payment completes transfer reconciliation and safely matches the payment records.</p></div>}{payout.paymentsHasMore && <div className="border-t border-[#e9eaed] px-5 py-4 text-[9px] text-[#8b8f97]">Additional balance entries exist for this transfer. ORBIT shows only safely matched payment records.</div>}</section>
    </div>
  </div>;
}

function Summary({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="rounded-[18px] border border-[#dfe1e5] bg-white p-5"><div className="flex items-center gap-2 text-[#7769dc]">{icon}<p className="text-[9px] font-semibold uppercase tracking-[.13em] text-[#999da5]">{label}</p></div><p className="mt-4 text-[13px] font-semibold text-[#373a40]">{value}</p></div>; }
function TimelineItem({ label, date, detail, last }: { label: string; date: number; detail: string; last?: boolean }) { return <div className="grid grid-cols-[22px_1fr] gap-3"><div className="flex flex-col items-center"><span className="mt-0.5 size-2.5 rounded-full border-[3px] border-[#7061df] bg-white" />{!last && <span className="min-h-16 w-px flex-1 bg-[#dedbef]" />}</div><div className="pb-7"><p className="text-[11px] font-medium text-[#373a40]">{label}</p><p className="mt-1 text-[9px] text-[#8d9199]">{formatPortalDateTime(date)} UTC</p><p className="mt-1 text-[9px] text-[#a3a6ad]">{detail}</p></div></div>; }
