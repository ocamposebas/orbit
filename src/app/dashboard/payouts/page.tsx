import Link from "next/link";
import { ArrowRight, CalendarClock, RefreshCw, ShieldCheck, Sparkles, WalletCards } from "lucide-react";
import { StatusPill } from "@/components/merchant-portal/status-pill";
import { WithdrawalCard } from "@/components/merchant-portal/withdrawal-card";
import { FundsAvailabilityCalendar } from "@/components/merchant-portal/funds-availability-calendar";
import { getPortalContext } from "@/merchant-portal/access";
import { getMerchantPayouts } from "@/merchant-portal/data";
import { stripeFinancialStatusMessage } from "@/merchant-portal/financial-status";
import { formatMoney, formatPortalDate, payoutStatusLabel } from "@/merchant-portal/format";

type Query = { cursor?: string | string[] };

export default async function PayoutsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const [{ merchant, session }, query] = await Promise.all([getPortalContext(), searchParams]);
  if (!merchant) return null;
  const cursor = typeof query.cursor === "string" ? query.cursor : undefined;
  const result = await getMerchantPayouts(merchant.id, { cursor });
  const administrator = ["OWNER", "ADMIN"].includes(session.role);
  const financialMessage = stripeFinancialStatusMessage({ ...result, administrator });
  const availableLabel = result.available.amountMinor === null ? "—" : formatMoney(result.available.amountMinor, result.available.currency);
  const pendingLabel = result.pending.amountMinor === null ? "—" : formatMoney(result.pending.amountMinor, result.pending.currency);
  const currency = result.available.currency || result.pending.currency || "USD";
  const negativeAvailable = result.available.amountMinor !== null && result.available.amountMinor < 0;
  const positiveAvailable = result.available.amountMinor !== null && result.available.amountMinor > 0;

  return <div className="mx-auto w-full max-w-[1480px] px-4 py-7 sm:px-7 lg:px-10 lg:py-10">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="flex items-center gap-2 text-[9px] font-semibold uppercase text-[#9588f3]"><Sparkles className="size-3" />ORBIT Payment · Money movement</p><h1 className="mt-3 text-[30px] font-semibold text-white sm:text-[38px]">Transfers</h1><p className="mt-2 text-[11px] text-[#777d89]">Control your balance, bank transfers and complete movement history.</p></div><div className="flex items-center gap-2 rounded-full border border-[#63caa5]/15 bg-[#63caa5]/[.05] px-3 py-2 text-[8px] font-medium text-[#82cdb2]"><ShieldCheck className="size-3.5" />Protected money movement</div></header>

    {financialMessage && <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-[#7868e8]/25 bg-[#7665e8]/[.08] px-4 py-3 text-[10px] leading-5 text-[#aaa2de] sm:flex-row sm:items-center"><div className="flex min-w-0 items-start gap-3"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#9587f2]" /><p>{financialMessage}</p></div><div className="ml-7 flex shrink-0 items-center gap-4 sm:ml-auto">{administrator && <Link href={`/sentinel/merchant/${merchant.id}`} className="text-[9px] font-semibold uppercase text-[#c4baff]">ORBIT setup</Link>}<Link href="/dashboard/payouts" className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase text-[#a99cff]"><RefreshCw className="size-3" />Refresh</Link></div></div>}

    <section className="mt-7 grid gap-4 xl:grid-cols-[1.18fr_.82fr]">
      <WithdrawalCard merchantId={merchant.id} availableMinor={result.available.amountMinor} currency={currency} canInitiate={merchant.canInitiatePayouts} balanceAvailable={result.balanceAvailable} administrator={administrator} payoutSchedule={result.payoutSchedule} destination={result.destination} twoFactorEnabled={Boolean(session.user.twoFactorEnabledAt)} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
        <div className="orbit-finance-card rounded-[24px] border border-white/[.075] p-6"><div className="flex items-center justify-between"><p className="text-[9px] font-semibold uppercase text-[#777d89]">{negativeAvailable ? "Balance deficit" : "Available now"}</p><span className={`size-2 rounded-full ${negativeAvailable ? "bg-[#e7ad67] shadow-[0_0_14px_rgba(231,173,103,.45)]" : positiveAvailable ? "bg-[#66d5ad] shadow-[0_0_14px_rgba(102,213,173,.65)]" : "bg-[#686e79]"}`} /></div><p className="mt-5 text-[34px] font-semibold text-white">{availableLabel}</p><p className="mt-2 text-[9px] leading-4 text-[#676d79]">{result.available.amountMinor === null ? "Live balance unavailable" : negativeAvailable ? `${formatMoney(Math.abs(result.available.amountMinor), result.available.currency)} must be covered before transfers can resume.` : positiveAvailable ? "Ready for an on-demand transfer" : "No funds are currently available to transfer"}</p></div>
        <div className="orbit-finance-card rounded-[24px] border border-white/[.075] p-6"><div className="flex items-center justify-between"><p className="text-[9px] font-semibold uppercase text-[#777d89]">Processing</p><CalendarClock className="size-3.5 text-[#8f82ef]" /></div><p className="mt-5 text-[34px] font-semibold text-white">{pendingLabel}</p><p className="mt-2 text-[9px] text-[#676d79]">Funds clearing before they become transferable</p></div>
      </div>
    </section>

    <FundsAvailabilityCalendar days={result.availability} available={result.availabilityAvailable} pendingMinor={result.pending.amountMinor} />

    <section className="mt-8 overflow-hidden rounded-[24px] border border-white/[.075] bg-[#0b0d13] shadow-[0_30px_90px_rgba(0,0,0,.18)]"><div className="flex items-end justify-between border-b border-white/[.07] px-5 py-5 sm:px-7"><div><p className="text-[9px] font-semibold uppercase text-[#777d89]">Complete history</p><h2 className="mt-2 text-[18px] font-semibold text-white">Transfer history</h2></div><WalletCards className="size-4 text-[#8f82ef]" /></div>{result.payouts.length ? <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left"><thead><tr className="border-b border-white/[.06] bg-white/[.018]">{["Date", "Transfer ID", "Amount", "Destination", "Arrival", "Status", ""].map((column) => <th key={column} className="px-5 py-3 text-[8px] font-semibold uppercase text-[#626874] first:pl-7 last:pr-7">{column}</th>)}</tr></thead><tbody>{result.payouts.map((payout) => <tr key={payout.id} className="group border-b border-white/[.055] last:border-0 transition hover:bg-[#8f7dff]/[.045]">{[
          formatPortalDate(payout.created), <span key="id" className="font-mono text-[9px] text-[#9e91f4]">{payout.id}</span>, <span key="amount" className="font-semibold text-[#e5e6ea]">{formatMoney(payout.amountMinor, payout.currency)}</span>, payout.destination, formatPortalDate(payout.arrivalDate), <StatusPill key="status" status={payoutStatusLabel(payout.status)} />, <ArrowRight key="arrow" className="size-3.5 text-[#656b77] transition group-hover:translate-x-0.5 group-hover:text-[#a99cff]" />,
        ].map((value, index) => <td key={index} className="p-0 text-[10px] text-[#7a808c] first:pl-2 last:pr-2"><Link href={`/dashboard/payouts/${payout.id}`} className="block min-h-14 px-3 py-5" aria-label={index === 0 ? `Open transfer ${payout.id}` : undefined}>{value}</Link></td>)}</tr>)}</tbody></table></div> : <div className="px-6 py-20 text-center"><span className="mx-auto grid size-12 place-items-center rounded-2xl border border-[#8f7dff]/15 bg-[#8f7dff]/[.07] text-[#9f93f5]"><WalletCards className="size-4" /></span><h2 className="mt-4 text-[15px] font-semibold text-white">No transfers yet</h2><p className="mx-auto mt-2 max-w-sm text-[10px] leading-5 text-[#6f7581]">Your first completed or scheduled ORBIT Payment transfer will appear here.</p></div>}{result.nextCursor && <div className="flex justify-end border-t border-white/[.06] px-5 py-4"><Link href={`/dashboard/payouts?cursor=${encodeURIComponent(result.nextCursor)}`} className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-white/[.08] px-3.5 text-[9px] font-medium text-[#9297a2]">Older transfers<ArrowRight className="size-3.5" /></Link></div>}</section>
  </div>;
}
