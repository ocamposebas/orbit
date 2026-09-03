"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, Copy, ExternalLink, Link2, LoaderCircle, LockKeyhole, Orbit, Plus, Power, ShieldCheck } from "lucide-react";

type MerchantOption = { id: string; businessName: string; allowed: boolean; ready: boolean };
type PaymentLinkRow = { id: string; publicId: string; title: string; description: string | null; amountMinor: number; currency: string; status: "ACTIVE" | "INACTIVE"; expiresAt: string | null; createdAt: string; accountName: string; platformOwned: boolean; createdBy: string; paymentCount: number; paidCount: number; collectedMinor: number };

function money(amountMinor: number, currency: string) { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amountMinor / 100); }

export function PaymentLinkManager({ role, merchants, canonicalOrigin }: { role: string; merchants: MerchantOption[]; canonicalOrigin: string }) {
  const owner = role === "OWNER";
  const administrator = owner || role === "ADMIN";
  const allowedMerchants = merchants.filter((merchant) => administrator || merchant.allowed);
  const featureEnabled = owner || allowedMerchants.length > 0;
  const [links, setLinks] = useState<PaymentLinkRow[]>([]);
  const [target, setTarget] = useState(owner ? "platform" : allowedMerchants[0]?.id ?? "");
  const [currency, setCurrency] = useState("USD");
  const [expiration, setExpiration] = useState("never");
  const [loading, setLoading] = useState(featureEnabled);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    if (!featureEnabled) return;
    setLoading(true);
    try { const response = await fetch("/api/portal/payment-links", { cache: "no-store" }); const body = await response.json() as { links?: PaymentLinkRow[]; error?: string }; if (!response.ok) throw new Error(body.error ?? "Unable to load Payment Links"); setLinks(body.links ?? []); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load Payment Links"); }
    finally { setLoading(false); }
  }, [featureEnabled]);

  useEffect(() => {
    if (!featureEnabled) return;
    let active = true;
    void fetch("/api/portal/payment-links", { cache: "no-store" })
      .then(async (response) => { const body = await response.json() as { links?: PaymentLinkRow[]; error?: string }; if (!response.ok) throw new Error(body.error ?? "Unable to load Payment Links"); if (active) { setLinks(body.links ?? []); setError(""); } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load Payment Links"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [featureEnabled]);
  const totals = useMemo(() => ({ active: links.filter((link) => link.status === "ACTIVE").length, paid: links.reduce((sum, link) => sum + link.paidCount, 0), collected: links.filter((link) => link.currency === currency).reduce((sum, link) => sum + link.collectedMinor, 0) }), [currency, links]);
  const selectedReady = target === "platform" || Boolean(merchants.find((merchant) => merchant.id === target)?.ready);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setCreating(true); setError("");
    const form = event.currentTarget; const data = new FormData(form);
    const numericAmount = Number(data.get("amount"));
    if (!Number.isFinite(numericAmount)) { setError("Enter a valid amount"); setCreating(false); return; }
    const expiresAt = expiration === "never" ? null : new Date(Date.now() + Number(expiration) * 3_600_000).toISOString();
    try {
      const response = await fetch("/api/portal/payment-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ merchantId: target === "platform" ? null : target, title: data.get("title"), description: data.get("description") || null, amountMinor: Math.round(numericAmount * 100), currency, expiresAt }) });
      const body = await response.json() as { link?: { publicId: string; url: string }; error?: string };
      if (!response.ok || !body.link) throw new Error(body.error ?? "Unable to create Payment Link");
      form.reset(); setCurrency("USD"); setExpiration("never"); await load(); await copy(body.link.publicId, body.link.url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create Payment Link"); }
    finally { setCreating(false); }
  }

  async function copy(id: string, url = `${canonicalOrigin}/pay/orbit/${id}`) {
    try { await navigator.clipboard.writeText(url); setCopied(id); window.setTimeout(() => setCopied(""), 1800); }
    catch { setError("Copying was blocked by your browser. Open the link and copy it from the address bar."); }
  }

  async function toggle(link: PaymentLinkRow) {
    setError("");
    try { const response = await fetch(`/api/portal/payment-links/${encodeURIComponent(link.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: link.status !== "ACTIVE" }) }); const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error ?? "Unable to update Payment Link"); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update Payment Link"); }
  }

  if (!featureEnabled) return <section className="mt-8 overflow-hidden rounded-[28px] border border-white/[.075] bg-[#0b0d13]"><div className="grid min-h-[440px] place-items-center px-6 py-16 text-center"><div><span className="mx-auto grid size-14 place-items-center rounded-2xl border border-[#8f7dff]/20 bg-[#8f7dff]/[.07] text-[#a89cff]"><LockKeyhole className="size-6" /></span><p className="mt-6 text-[9px] font-semibold uppercase tracking-[.16em] text-[#9385f2]">Controlled capability</p><h2 className="mt-3 text-[24px] font-semibold tracking-[-.04em] text-white">Payment Links is ready when you are.</h2><p className="mx-auto mt-3 max-w-md text-[11px] leading-5 text-[#777d89]">Ask your ORBIT administrator to enable Payment Links for your account. Once enabled, you can create and publish links instantly—individual payments do not require approval.</p><span title="Contact your ORBIT administrator to request Payment Links access." className="mt-6 inline-flex cursor-help items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.025] px-4 py-3 text-[10px] text-[#8e939e]"><LockKeyhole className="size-3.5" />Contact your ORBIT administrator</span></div></div></section>;

  return <>
    <section className="mt-8 grid gap-3 sm:grid-cols-3"><div className="rounded-[18px] border border-white/[.07] bg-[#0b0d13] p-4"><p className="text-[8px] uppercase tracking-[.14em] text-[#626874]">Active links</p><p className="mt-3 text-[25px] font-semibold tracking-[-.04em] text-white">{totals.active}</p></div><div className="rounded-[18px] border border-white/[.07] bg-[#0b0d13] p-4"><p className="text-[8px] uppercase tracking-[.14em] text-[#626874]">Successful payments</p><p className="mt-3 text-[25px] font-semibold tracking-[-.04em] text-white">{totals.paid}</p></div><div className="rounded-[18px] border border-[#8f7dff]/15 bg-[#8f7dff]/[.045] p-4"><p className="text-[8px] uppercase tracking-[.14em] text-[#7369b6]">Collected · {currency}</p><p className="mt-3 text-[25px] font-semibold tracking-[-.04em] text-[#c7bfff]">{money(totals.collected, currency)}</p></div></section>
    {error && <p className="mt-5 rounded-xl border border-[#e46d85]/20 bg-[#e46d85]/[.06] px-4 py-3 text-[10px] text-[#eaa0af]" role="alert">{error}</p>}
    <div className="mt-5 grid gap-5 xl:grid-cols-[390px_1fr]">
      <section className="h-fit rounded-[24px] border border-white/[.075] bg-[#0b0d13] p-5 xl:sticky xl:top-20"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-[#8f7dff]/10 text-[#a99cff]"><Plus className="size-4" /></span><div><h2 className="text-[13px] font-semibold text-white">Create a payment link</h2><p className="mt-0.5 text-[9px] text-[#686e79]">Live as soon as you publish it.</p></div></div><form onSubmit={create} className="mt-6 space-y-4">
        {owner && <label className="block text-[9px] text-[#7c818d]">Payment account<select value={target} onChange={(event) => setTarget(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-white/[.09] bg-[#11131a] px-3 text-[11px] text-white outline-none focus:border-[#8f7dff]/60"><option value="platform">ORBIT · Platform account</option>{merchants.map((merchant) => <option key={merchant.id} value={merchant.id} disabled={!merchant.ready}>{merchant.businessName}{merchant.ready ? "" : " · not ready"}</option>)}</select></label>}
        {!owner && allowedMerchants.length > 1 && <label className="block text-[9px] text-[#7c818d]">Payment account<select value={target} onChange={(event) => setTarget(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-white/[.09] bg-[#11131a] px-3 text-[11px] text-white outline-none focus:border-[#8f7dff]/60">{allowedMerchants.map((merchant) => <option key={merchant.id} value={merchant.id} disabled={!merchant.ready}>{merchant.businessName}{merchant.ready ? "" : " · not ready"}</option>)}</select></label>}
        <label className="block text-[9px] text-[#7c818d]">Title<input required name="title" minLength={2} maxLength={120} placeholder="Design consultation" className="mt-1.5 h-11 w-full rounded-xl border border-white/[.09] bg-white/[.025] px-3 text-[11px] text-white outline-none placeholder:text-[#4e535e] focus:border-[#8f7dff]/60" /></label>
        <label className="block text-[9px] text-[#7c818d]">Description <span className="text-[#505560]">· optional</span><textarea name="description" maxLength={500} rows={3} placeholder="What this payment is for" className="mt-1.5 w-full resize-none rounded-xl border border-white/[.09] bg-white/[.025] px-3 py-3 text-[11px] text-white outline-none placeholder:text-[#4e535e] focus:border-[#8f7dff]/60" /></label>
        <div className="grid grid-cols-[1fr_104px] gap-2"><label className="block text-[9px] text-[#7c818d]">Amount<input required name="amount" type="number" min="1" max="9999999.99" step="0.01" placeholder="0.00" className="mt-1.5 h-11 w-full rounded-xl border border-white/[.09] bg-white/[.025] px-3 text-[11px] text-white outline-none focus:border-[#8f7dff]/60" /></label><label className="block text-[9px] text-[#7c818d]">Currency<select value={currency} onChange={(event) => setCurrency(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-white/[.09] bg-[#11131a] px-3 text-[11px] text-white outline-none">{["USD","COP","EUR","GBP","CAD","MXN"].map((value) => <option key={value}>{value}</option>)}</select></label></div>
        <label className="block text-[9px] text-[#7c818d]">Expiration<select value={expiration} onChange={(event) => setExpiration(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-white/[.09] bg-[#11131a] px-3 text-[11px] text-white outline-none"><option value="never">Never expires</option><option value="24">24 hours</option><option value="168">7 days</option><option value="720">30 days</option></select></label>
        <div className="rounded-xl border border-[#6dcca8]/15 bg-[#6dcca8]/[.045] p-3 text-[9px] leading-4 text-[#78bda4]"><ShieldCheck className="mr-1.5 inline size-3.5" />The destination and amount are signed on the server. They cannot be changed from the checkout.</div>
        {!selectedReady && <p className="rounded-xl border border-[#d7ae64]/15 bg-[#d7ae64]/[.05] p-3 text-[9px] leading-4 text-[#c7ad77]">This account must complete ORBIT Payment activation before it can publish links.</p>}
        <button disabled={creating || !target || !selectedReady} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#6654e8] to-[#927bff] text-[10px] font-semibold text-white shadow-[0_12px_30px_rgba(112,87,235,.2)] disabled:opacity-45">{creating ? <LoaderCircle className="size-4 animate-spin" /> : <Link2 className="size-4" />}{creating ? "Creating secure link…" : "Create and publish"}</button>
      </form></section>
      <section className="overflow-hidden rounded-[24px] border border-white/[.075] bg-[#0b0d13]"><div className="flex items-center justify-between border-b border-white/[.06] px-5 py-4"><div><h2 className="text-[12px] font-semibold text-white">Your links</h2><p className="mt-1 text-[8px] text-[#626874]">Reusable checkout pages powered by ORBIT.</p></div><span className="flex items-center gap-1.5 text-[8px] text-[#66c7a4]"><span className="size-1.5 rounded-full bg-[#66c7a4]" />Live data</span></div>
        {loading ? <div className="grid min-h-64 place-items-center text-[#747a86]"><LoaderCircle className="size-5 animate-spin" /></div> : links.length === 0 ? <div className="grid min-h-64 place-items-center px-5 text-center"><div><span className="mx-auto grid size-11 place-items-center rounded-2xl bg-white/[.035] text-[#777d88]"><Link2 className="size-5" /></span><h3 className="mt-4 text-[13px] text-[#cfd1d7]">No links yet</h3><p className="mt-2 text-[9px] text-[#626874]">Create your first polished ORBIT checkout.</p></div></div> : <div>{links.map((link) => <article key={link.id} className="group border-b border-white/[.055] p-5 last:border-0 hover:bg-white/[.012]"><div className="flex flex-col gap-4 sm:flex-row sm:items-center"><span className={`grid size-10 shrink-0 place-items-center rounded-xl ${link.platformOwned ? "bg-[#8f7dff]/10 text-[#a99cff]" : "bg-white/[.04] text-[#888e99]"}`}>{link.platformOwned ? <Orbit className="size-4" /> : <Link2 className="size-4" />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-[11px] font-medium text-[#e7e8ec]">{link.title}</h3><span className={`rounded-full border px-2 py-0.5 text-[7px] uppercase tracking-[.08em] ${link.status === "ACTIVE" ? "border-[#62c7a2]/15 bg-[#62c7a2]/[.05] text-[#70caaa]" : "border-white/[.08] text-[#676c77]"}`}>{link.status}</span></div><p className="mt-1.5 truncate text-[8px] text-[#656b76]">{link.accountName} · by {link.createdBy} · {new Date(link.createdAt).toLocaleDateString()}</p></div><div className="sm:text-right"><p className="text-[13px] font-semibold text-white">{money(link.amountMinor, link.currency)}</p><p className="mt-1 text-[8px] text-[#636975]">{link.paidCount} paid · {money(link.collectedMinor, link.currency)} collected</p></div><div className="flex gap-2"><button type="button" onClick={() => void copy(link.publicId)} title="Copy public checkout URL" className="grid size-9 place-items-center rounded-xl border border-white/[.08] text-[#7d838e] hover:border-[#8f7dff]/30 hover:text-[#b5aaff]">{copied === link.publicId ? <CheckCircle2 className="size-3.5 text-[#69c9a6]" /> : <Copy className="size-3.5" />}</button><a href={`/pay/orbit/${link.publicId}`} target="_blank" rel="noreferrer" title="Open checkout" className="grid size-9 place-items-center rounded-xl border border-white/[.08] text-[#7d838e] hover:text-white"><ExternalLink className="size-3.5" /></a><button type="button" onClick={() => void toggle(link)} title={link.status === "ACTIVE" ? "Deactivate link" : "Activate link"} className={`grid size-9 place-items-center rounded-xl border ${link.status === "ACTIVE" ? "border-[#e0788c]/15 text-[#b77783]" : "border-[#68c7a5]/15 text-[#69b99d]"}`}><Power className="size-3.5" /></button></div></div></article>)}</div>}
      </section>
    </div>
  </>;
}
