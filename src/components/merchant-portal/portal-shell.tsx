"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeftRight, BadgeDollarSign, ChevronDown, CircleHelp, CreditCard, FileText, LayoutDashboard, Layers3, LogOut, Menu, RefreshCw, ScanSearch, Settings, WalletCards, X } from "lucide-react";
import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";

export function PortalShell({ children, merchantName, merchantId, merchants, userName, adminPortfolio, ownerEarnings, statementsEnabled }: { children: React.ReactNode; merchantName: string; merchantId: string; merchants: Array<{ id: string; businessName: string }>; userName: string; adminPortfolio: boolean; ownerEarnings: boolean; statementsEnabled: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [switching, setSwitching] = useState(false);
  const merchantNavigation = [
    { href: adminPortfolio ? "/dashboard?view=brand" : "/dashboard", label: "Overview", icon: LayoutDashboard },
    { href: adminPortfolio ? `/dashboard/payments?merchant=${encodeURIComponent(merchantId)}` : "/dashboard/payments", label: "Payments", icon: CreditCard },
    { href: "/dashboard/payouts", label: "Transfers", icon: WalletCards },
    ...(statementsEnabled ? [{ href: "/dashboard/statements", label: "Statements", icon: FileText }] : []),
    { href: "/dashboard/scans", label: "Scans", icon: ScanSearch },
  ];

  function refresh() {
    startRefresh(() => router.refresh());
  }

  async function switchMerchant(nextMerchantId: string) {
    if (!nextMerchantId || nextMerchantId === merchantId) return;
    setSwitching(true);
    try {
      const response = await fetch("/api/portal/merchant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ merchantId: nextMerchantId }) });
      if (!response.ok) throw new Error("Unable to switch merchant");
      router.push(adminPortfolio ? "/dashboard?view=brand" : "/dashboard");
      router.refresh();
    } finally { setSwitching(false); }
  }

  return <div className="merchant-portal min-h-dvh bg-[#07080d] text-[#f0f1f4]">
    <aside className={cn("fixed inset-y-0 left-0 z-[70] flex w-[248px] flex-col border-r border-white/[.07] bg-[#090a10] transition-transform lg:translate-x-0", mobileOpen ? "translate-x-0" : "-translate-x-full")}>
      <div className="flex h-20 items-center border-b border-white/[.07] px-6">
        <Link href="/dashboard" className="flex items-center gap-2.5" onClick={() => setMobileOpen(false)}><span className="grid size-9 place-items-center rounded-xl border border-[#8e7dff]/20 bg-[#8e7dff]/10 text-white shadow-[0_0_24px_rgba(124,92,255,.12)]"><span className="size-2.5 rounded-full border-[3px] border-[#9a8aff]" /></span><span><span className="block text-[14px] font-semibold">ORBIT</span><span className="block text-[7px] font-medium uppercase text-[#686e7a]">Payment</span></span></Link>
        <button onClick={() => setMobileOpen(false)} className="ml-auto grid size-8 place-items-center rounded-lg text-[#747982] lg:hidden" aria-label="Close navigation"><X className="size-4" /></button>
      </div>
      <div className="px-4 py-5">
        <div className="relative flex w-full items-center gap-3 rounded-xl border border-white/[.08] bg-white/[.025] px-3 py-3 text-left" aria-label={`Current business: ${merchantName}`}>
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#7868e8]/15 text-[11px] font-semibold text-[#aa9fff]">{merchantName.slice(0, 2).toUpperCase()}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium text-[#e0e2e7]">{merchantName}</span><span className="mt-0.5 block text-[9px] uppercase tracking-[.12em] text-[#656a75]">Selected brand</span></span>
          {merchants.length > 1 && <><ChevronDown className="size-3.5 text-[#a0a4ac]" /><select value={merchantId} disabled={switching} onChange={(event) => void switchMerchant(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Switch merchant account">{merchants.map((merchant) => <option key={merchant.id} value={merchant.id}>{merchant.businessName}</option>)}</select></>}
        </div>
      </div>
      <nav className="px-3" aria-label="Merchant portal navigation">{adminPortfolio && <><Link href="/dashboard" onClick={() => setMobileOpen(false)} className={cn("mb-1 flex h-10 items-center gap-3 rounded-[10px] px-3 text-[12px] font-medium transition", pathname === "/dashboard" ? "bg-[#7868e8]/12 text-[#b3a9ff]" : "text-[#777c88] hover:bg-white/[.04] hover:text-white")}><Layers3 className="size-4 text-[#9182f0]" />Portfolio</Link><Link href="/dashboard/payments" onClick={() => setMobileOpen(false)} className={cn("mb-1 flex h-10 items-center gap-3 rounded-[10px] px-3 text-[12px] font-medium transition", pathname.startsWith("/dashboard/payments") ? "bg-[#7868e8]/12 text-[#b3a9ff]" : "text-[#777c88] hover:bg-white/[.04] hover:text-white")}><CreditCard className="size-4 text-[#9182f0]" />All payments</Link>{ownerEarnings && <Link href="/dashboard/earnings" onClick={() => setMobileOpen(false)} className={cn("mb-4 flex h-10 items-center gap-3 rounded-[10px] px-3 text-[12px] font-medium transition", pathname.startsWith("/dashboard/earnings") ? "bg-[#7868e8]/12 text-[#b3a9ff]" : "text-[#777c88] hover:bg-white/[.04] hover:text-white")}><BadgeDollarSign className="size-4 text-[#9182f0]" />ORBIT Earnings</Link>}<p className="mb-2 px-3 text-[8px] font-semibold uppercase tracking-[.14em] text-[#4f5460]">Selected brand</p></>}{merchantNavigation.map((item) => { const Icon = item.icon; const baseHref = item.href.split("?")[0]; const active = baseHref === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(baseHref); return <Link key={item.label} href={item.href} onClick={() => setMobileOpen(false)} className={cn("mb-1 flex h-10 items-center gap-3 rounded-[10px] px-3 text-[12px] font-medium transition", active ? "bg-[#7868e8]/12 text-[#b3a9ff]" : "text-[#777c88] hover:bg-white/[.04] hover:text-white")}><Icon className={cn("size-4", active ? "text-[#9788f3]" : "text-[#676c78]")} />{item.label}</Link>; })}</nav>
      <div className="mt-auto px-3 pb-4">
        <Link href="/dashboard/settings" className="flex h-10 items-center gap-3 rounded-[10px] px-3 text-[12px] text-[#707581] hover:bg-white/[.04] hover:text-white"><Settings className="size-4" />Settings</Link>
        <Link href="/contact" className="flex h-10 items-center gap-3 rounded-[10px] px-3 text-[12px] text-[#707581] hover:bg-white/[.04] hover:text-white"><CircleHelp className="size-4" />Support</Link>
        <div className="mt-3 flex items-center gap-2 border-t border-white/[.07] px-2 pt-4"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#7868e8]/15 text-[10px] font-semibold text-[#b3a9ff]">{userName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span className="min-w-0 flex-1 truncate text-[11px] text-[#858a95]">{userName}</span><button onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }} className="grid size-8 place-items-center rounded-lg text-[#656a76] hover:bg-white/[.05] hover:text-white" aria-label="Sign out"><LogOut className="size-3.5" /></button></div>
      </div>
    </aside>
    {mobileOpen && <button className="fixed inset-0 z-[65] bg-black/25 backdrop-blur-[2px] lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" />}
    <div className="lg:pl-[248px]">
      <header className="sticky top-0 z-50 flex h-16 items-center border-b border-white/[.07] bg-[#08090e]/90 px-4 backdrop-blur-xl sm:px-7 lg:px-10">
        <button onClick={() => setMobileOpen(true)} className="mr-3 grid size-9 place-items-center rounded-[10px] border border-white/[.08] bg-white/[.025] text-[#8b909b] lg:hidden" aria-label="Open navigation"><Menu className="size-4" /></button>
        <div className="flex items-center gap-2 text-[11px] text-[#6c717d]"><ArrowLeftRight className="size-3.5 text-[#9182f0]" /><span>ORBIT Payment · Live</span><span className="size-1.5 rounded-full bg-[#65d1aa] shadow-[0_0_10px_rgba(101,209,170,.7)]" /></div>
        <button onClick={refresh} disabled={refreshing} className="ml-auto inline-flex h-9 items-center gap-2 rounded-[10px] border border-white/[.08] bg-white/[.025] px-3.5 text-[11px] font-medium text-[#a6aab3] transition hover:border-[#7868e8]/30 hover:bg-[#7868e8]/[.06] disabled:opacity-60"><RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />{refreshing ? "Refreshing" : "Refresh"}</button>
      </header>
      <main>{children}</main>
    </div>
  </div>;
}
