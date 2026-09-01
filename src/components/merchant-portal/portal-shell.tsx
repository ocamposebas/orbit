"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeftRight, ChevronDown, CircleHelp, CreditCard, LayoutDashboard, LogOut, Menu, RefreshCw, Settings, WalletCards, X } from "lucide-react";
import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/payments", label: "Payments", icon: CreditCard },
  { href: "/dashboard/payouts", label: "Payouts", icon: WalletCards },
];

export function PortalShell({ children, merchantName, merchantId, merchants, userName }: { children: React.ReactNode; merchantName: string; merchantId: string; merchants: Array<{ id: string; businessName: string }>; userName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [switching, setSwitching] = useState(false);

  function refresh() {
    startRefresh(() => router.refresh());
  }

  async function switchMerchant(nextMerchantId: string) {
    if (!nextMerchantId || nextMerchantId === merchantId) return;
    setSwitching(true);
    try {
      const response = await fetch("/api/portal/merchant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ merchantId: nextMerchantId }) });
      if (!response.ok) throw new Error("Unable to switch merchant");
      router.push("/dashboard");
      router.refresh();
    } finally { setSwitching(false); }
  }

  return <div className="merchant-portal min-h-dvh bg-[#f4f5f7] text-[#15171a]">
    <aside className={cn("fixed inset-y-0 left-0 z-[70] flex w-[248px] flex-col border-r border-[#e5e7eb] bg-[#fbfbfc] transition-transform lg:translate-x-0", mobileOpen ? "translate-x-0" : "-translate-x-full")}>
      <div className="flex h-20 items-center border-b border-[#e7e8eb] px-6">
        <Link href="/dashboard" className="flex items-center gap-2.5" onClick={() => setMobileOpen(false)}><span className="grid size-8 place-items-center rounded-[10px] bg-[#111318] text-white shadow-sm"><span className="size-2.5 rounded-full border-[3px] border-[#8e7dff]" /></span><span className="text-[15px] font-semibold tracking-[-.035em]">ORBIT</span></Link>
        <button onClick={() => setMobileOpen(false)} className="ml-auto grid size-8 place-items-center rounded-lg text-[#747982] lg:hidden" aria-label="Close navigation"><X className="size-4" /></button>
      </div>
      <div className="px-4 py-5">
        <div className="relative flex w-full items-center gap-3 rounded-xl border border-[#e4e5e9] bg-white px-3 py-3 text-left shadow-[0_1px_2px_rgba(16,24,40,.03)]" aria-label={`Current business: ${merchantName}`}>
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#ebe8ff] text-[11px] font-semibold text-[#6556d9]">{merchantName.slice(0, 2).toUpperCase()}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium text-[#272a2f]">{merchantName}</span><span className="mt-0.5 block text-[9px] uppercase tracking-[.12em] text-[#979ba3]">Merchant account</span></span>
          {merchants.length > 1 && <><ChevronDown className="size-3.5 text-[#a0a4ac]" /><select value={merchantId} disabled={switching} onChange={(event) => void switchMerchant(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Switch merchant account">{merchants.map((merchant) => <option key={merchant.id} value={merchant.id}>{merchant.businessName}</option>)}</select></>}
        </div>
      </div>
      <nav className="px-3" aria-label="Merchant portal navigation">{navigation.map((item) => { const Icon = item.icon; const active = item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href); return <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className={cn("mb-1 flex h-10 items-center gap-3 rounded-[10px] px-3 text-[12px] font-medium transition", active ? "bg-[#eeecff] text-[#5547c7]" : "text-[#747983] hover:bg-[#f0f1f3] hover:text-[#30333a]")}><Icon className={cn("size-4", active ? "text-[#6d5ee7]" : "text-[#92969e]")} />{item.label}</Link>; })}</nav>
      <div className="mt-auto px-3 pb-4">
        <Link href="/sentinel/profile" className="flex h-10 items-center gap-3 rounded-[10px] px-3 text-[12px] text-[#747983] hover:bg-[#f0f1f3]"><Settings className="size-4 text-[#92969e]" />Settings</Link>
        <Link href="/contact" className="flex h-10 items-center gap-3 rounded-[10px] px-3 text-[12px] text-[#747983] hover:bg-[#f0f1f3]"><CircleHelp className="size-4 text-[#92969e]" />Support</Link>
        <div className="mt-3 flex items-center gap-2 border-t border-[#e5e7eb] px-2 pt-4"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#22252a] text-[10px] font-semibold text-white">{userName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span className="min-w-0 flex-1 truncate text-[11px] text-[#4c5058]">{userName}</span><button onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }} className="grid size-8 place-items-center rounded-lg text-[#a1a5ad] hover:bg-[#eceef0] hover:text-[#42464d]" aria-label="Sign out"><LogOut className="size-3.5" /></button></div>
      </div>
    </aside>
    {mobileOpen && <button className="fixed inset-0 z-[65] bg-black/25 backdrop-blur-[2px] lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" />}
    <div className="lg:pl-[248px]">
      <header className="sticky top-0 z-50 flex h-16 items-center border-b border-[#e4e6ea] bg-[#f8f9fa]/90 px-4 backdrop-blur-xl sm:px-7 lg:px-10">
        <button onClick={() => setMobileOpen(true)} className="mr-3 grid size-9 place-items-center rounded-[10px] border border-[#e1e3e6] bg-white text-[#60656d] lg:hidden" aria-label="Open navigation"><Menu className="size-4" /></button>
        <div className="flex items-center gap-2 text-[11px] text-[#90949b]"><ArrowLeftRight className="size-3.5" /><span>Live financial data</span></div>
        <button onClick={refresh} disabled={refreshing} className="ml-auto inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#dedfe3] bg-white px-3.5 text-[11px] font-medium text-[#555a62] shadow-[0_1px_2px_rgba(16,24,40,.03)] transition hover:border-[#cfd1d6] hover:bg-[#fcfcfd] disabled:opacity-60"><RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />{refreshing ? "Refreshing" : "Refresh"}</button>
      </header>
      <main>{children}</main>
    </div>
  </div>;
}
