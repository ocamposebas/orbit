"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, CreditCard, LoaderCircle, LockKeyhole, Send, ShieldCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { formatMoney } from "@/merchant-portal/format";
import type { PortalPayoutDestination } from "@/merchant-portal/data";

type TransferResult = { id: string; amountMinor: number; currency: string; status: string; arrivalDate: number };

export function WithdrawalCard({ merchantId, availableMinor, currency, canInitiate, balanceAvailable, administrator, payoutSchedule, destination }: { merchantId: string; availableMinor: number | null; currency: string; canInitiate: boolean; balanceAvailable: boolean; administrator: boolean; payoutSchedule: string | null; destination: PortalPayoutDestination | null }) {
  const router = useRouter();
  const [amount, setAmount] = useState(availableMinor !== null && availableMinor > 0 ? (availableMinor / 100).toFixed(2) : "");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [setupConfirm, setSetupConfirm] = useState(false);
  const [activeSchedule, setActiveSchedule] = useState(payoutSchedule);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TransferResult | null>(null);
  const requestKey = useRef<string | null>(null);
  const amountMinor = useMemo(() => {
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount.trim())) return 0;
    return Math.round(Number(amount) * 100);
  }, [amount]);
  const valid = Boolean(balanceAvailable && canInitiate && availableMinor && availableMinor > 0 && amountMinor > 0 && amountMinor <= availableMinor);

  async function submit() {
    if (!valid || submitting) return;
    setSubmitting(true); setError("");
    try {
      requestKey.current ??= crypto.randomUUID();
      const response = await fetch("/api/portal/payouts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ merchantId, amountMinor, currency, idempotencyKey: requestKey.current }),
      });
      const body = await response.json() as { transfer?: TransferResult; error?: string };
      if (!response.ok || !body.transfer) throw new Error(body.error ?? "Unable to create transfer");
      setResult(body.transfer); requestKey.current = null; setConfirming(false); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create transfer"); }
    finally { setSubmitting(false); }
  }

  async function enableOnDemandTransfers() {
    setEnabling(true); setError("");
    try {
      const response = await fetch("/api/portal/payouts", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ merchantId }) });
      const body = await response.json() as { enabled?: boolean; error?: string };
      if (!response.ok || !body.enabled) throw new Error(body.error ?? "Unable to enable on-demand transfers");
      setActiveSchedule("manual"); setSetupConfirm(false); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to enable on-demand transfers"); }
    finally { setEnabling(false); }
  }

  return <section className="orbit-transfer-card relative overflow-hidden rounded-[26px] border border-[#8f7dff]/25 p-6 sm:p-7">
    <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full border border-[#8f7dff]/20" />
    <div className="pointer-events-none absolute right-4 top-5 size-24 rounded-full bg-[#7c5cff]/10 blur-3xl" />
    <div className="relative">
      <div className="flex items-start justify-between gap-4"><div><p className="flex items-center gap-2 text-[9px] font-semibold uppercase text-[#a99cff]"><Sparkles className="size-3" />ORBIT Payment</p><h2 className="mt-2 text-[21px] font-semibold text-white">Transfer your balance</h2><p className="mt-2 max-w-md text-[10px] leading-5 text-[#8d92a0]">Send available funds to the payout account connected to this brand.</p></div><span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-[#8f7dff]/20 bg-[#8f7dff]/10 text-[#b2a7ff]"><Send className="size-4" /></span></div>
      <DestinationCard destination={destination} />
      {result ? <div className="mt-5 rounded-2xl border border-[#58d6aa]/20 bg-[#58d6aa]/[.07] p-5"><div className="flex items-center gap-2 text-[11px] font-semibold text-[#81e2bf]"><CheckCircle2 className="size-4" />Transfer requested</div><p className="mt-3 text-[28px] font-semibold text-white">{formatMoney(result.amountMinor, result.currency)}</p><p className="mt-2 text-[9px] text-[#8d9c98]">ORBIT Payment is processing the transfer to your payout destination.</p><Link href={`/dashboard/payouts/${result.id}`} className="mt-4 inline-flex items-center gap-1.5 text-[9px] font-semibold text-[#a99cff]">View transfer <ArrowRight className="size-3" /></Link></div> : !balanceAvailable ? <TransferState icon={<AlertTriangle className="size-4" />} title="Live balance unavailable" detail="ORBIT Payment cannot validate a transferable amount right now. Refresh after the financial connection is available." tone="warning" /> : !canInitiate ? <TransferState icon={<LockKeyhole className="size-4" />} title="Read-only access" detail="Ask your ORBIT administrator to enable balance transfers for this brand." /> : activeSchedule !== "manual" ? <div className="mt-5 rounded-2xl border border-[#8f7dff]/20 bg-black/20 p-5"><div className="flex items-center gap-2 text-[10px] font-medium text-[#83d5b6]"><CheckCircle2 className="size-4" />Your transfer permission is active</div><div className="mt-3 flex items-start gap-2.5 rounded-xl border border-white/[.06] bg-white/[.02] p-3"><LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-[#9b8cff]" /><div><p className="text-[9px] font-medium text-[#c9c5ff]">One administrator setup step remains</p><p className="mt-1 text-[8px] leading-4 text-[#737985]">This brand still uses automatic scheduled deposits. An ORBIT administrator must explicitly switch it to on-demand transfers before authorized users can send money.</p></div></div>{error && <p role="alert" className="mt-3 text-[9px] text-[#e69aae]">{error}</p>}{administrator ? setupConfirm ? <div className="mt-4 rounded-xl border border-[#e2bd68]/15 bg-[#e2bd68]/[.05] p-3"><p className="text-[9px] leading-4 text-[#c9b477]">Scheduled automatic deposits will stop. ORBIT administrators become responsible for sending available funds within the applicable holding period.</p><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => setSetupConfirm(false)} className="h-9 rounded-lg border border-white/[.08] text-[8px] text-[#8f949f]">Keep scheduled</button><button type="button" disabled={enabling} onClick={() => void enableOnDemandTransfers()} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#8f7dff] text-[8px] font-semibold text-white disabled:opacity-50">{enabling && <LoaderCircle className="size-3 animate-spin" />}Enable on-demand</button></div></div> : <button type="button" onClick={() => setSetupConfirm(true)} className="mt-4 h-10 w-full rounded-xl border border-[#8f7dff]/25 bg-[#8f7dff]/10 text-[9px] font-semibold text-[#c9c5ff]">Complete administrator setup</button> : <p className="mt-3 text-[8px] text-[#696f7a]">Your permission is ready. Ask an administrator to complete this brand&apos;s transfer setup.</p>}</div> : availableMinor === null || availableMinor <= 0 ? <TransferState icon={<AlertTriangle className="size-4" />} title={availableMinor !== null && availableMinor < 0 ? "Negative balance — transfers paused" : "No available balance to transfer"} detail={availableMinor !== null && availableMinor < 0 ? `${formatMoney(Math.abs(availableMinor), currency)} must be covered before a bank transfer can be created. Pending funds cannot be sent until they clear.` : "Pending funds cannot be transferred yet. This form will unlock automatically when funds become available."} tone="warning" /> : <>
        <div className="mt-6"><div className="flex items-center justify-between"><label htmlFor="transfer-amount" className="text-[9px] font-medium text-[#9ca0aa]">Transfer amount</label><button type="button" disabled={!availableMinor} onClick={() => { if (availableMinor) { setAmount((availableMinor / 100).toFixed(2)); requestKey.current = null; } }} className="text-[8px] font-semibold uppercase text-[#a99cff] disabled:opacity-40">Use full balance</button></div><div className="mt-2 flex h-14 items-center rounded-2xl border border-white/[.1] bg-black/25 px-4 focus-within:border-[#8f7dff]/50 focus-within:ring-4 focus-within:ring-[#7c5cff]/10"><span className="text-[11px] font-semibold text-[#777d89]">{currency.toUpperCase()}</span><input id="transfer-amount" inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); requestKey.current = null; setConfirming(false); setError(""); }} className="min-w-0 flex-1 bg-transparent px-3 text-right text-[24px] font-semibold text-white outline-none" aria-describedby="transfer-available" /></div><p id="transfer-available" className="mt-2 text-right text-[9px] text-[#666c78]">Available {availableMinor === null ? "—" : formatMoney(availableMinor, currency)}</p></div>
        {error && <p role="alert" className="mt-4 rounded-xl border border-[#ff87a7]/20 bg-[#ff87a7]/[.06] px-3.5 py-3 text-[9px] leading-4 text-[#e69aae]">{error}</p>}
        {confirming ? <div className="mt-5 rounded-2xl border border-[#8f7dff]/25 bg-[#8f7dff]/[.07] p-4"><p className="text-[10px] font-medium text-white">Confirm {formatMoney(amountMinor, currency)} transfer?</p><p className="mt-1 text-[8px] leading-4 text-[#858a96]">This creates a real standard bank transfer. Processing time depends on the destination bank.</p><div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => setConfirming(false)} className="h-10 rounded-xl border border-white/[.09] text-[9px] text-[#9da1aa]">Cancel</button><button type="button" onClick={() => void submit()} disabled={submitting} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#8f7dff] text-[9px] font-semibold text-white shadow-[0_10px_30px_rgba(124,92,255,.28)] disabled:opacity-60">{submitting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}{submitting ? "Sending…" : "Confirm transfer"}</button></div></div> : <button type="button" disabled={!valid} onClick={() => setConfirming(true)} className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#7158ef] to-[#9a7cff] text-[10px] font-semibold text-white shadow-[0_14px_36px_rgba(124,92,255,.22)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"><Send className="size-3.5" />Review transfer</button>}
      </>}
    </div>
  </section>;
}

function DestinationCard({ destination }: { destination: PortalPayoutDestination | null }) {
  const Icon = destination?.type === "card" ? CreditCard : Building2;
  const unhealthy = destination?.status === "errored" || destination?.status === "verification_failed";
  return <div className="mt-5 flex items-center gap-3 rounded-2xl border border-white/[.075] bg-black/20 px-4 py-3.5"><span className="grid size-9 shrink-0 place-items-center rounded-xl border border-[#8f7dff]/15 bg-[#8f7dff]/[.07] text-[#9f93f5]"><Icon className="size-4" /></span><div className="min-w-0 flex-1"><p className="text-[8px] font-semibold uppercase tracking-[.12em] text-[#656b77]">Payout destination</p>{destination ? <><p className="mt-1 truncate text-[11px] font-medium text-[#d5d7dd]">{destination.name} · ending in {destination.last4}</p><p className="mt-1 text-[8px] text-[#6c727e]">{destination.type === "card" ? "Debit card" : "Bank account"}{destination.currency ? ` · ${destination.currency}` : ""}{destination.country ? ` · ${destination.country}` : ""}{destination.expires ? ` · Expires ${destination.expires}` : ""}</p></> : <><p className="mt-1 text-[10px] font-medium text-[#b7bac3]">Destination details unavailable</p><p className="mt-1 text-[8px] text-[#666c78]">ORBIT Payment could not read the connected payout account.</p></>}</div>{destination && (unhealthy ? <span className="rounded-full border border-[#e59a68]/15 bg-[#e59a68]/[.06] px-2 py-1 text-[7px] font-semibold uppercase text-[#d8a27c]">Action needed</span> : <ShieldCheck className="size-4 shrink-0 text-[#63caa5]" />)}</div>;
}

function TransferState({ icon, title, detail, tone = "neutral" }: { icon: React.ReactNode; title: string; detail: string; tone?: "neutral" | "warning" }) {
  return <div className={`mt-5 flex items-start gap-3 rounded-2xl border p-4 ${tone === "warning" ? "border-[#e2bd68]/15 bg-[#e2bd68]/[.045]" : "border-white/[.07] bg-black/20"}`}><span className={tone === "warning" ? "text-[#d6b66f]" : "text-[#8f82ef]"}>{icon}</span><div><p className={`text-[10px] font-medium ${tone === "warning" ? "text-[#d6c08a]" : "text-[#c9cbd2]"}`}>{title}</p><p className="mt-1 text-[9px] leading-4 text-[#717681]">{detail}</p></div></div>;
}
