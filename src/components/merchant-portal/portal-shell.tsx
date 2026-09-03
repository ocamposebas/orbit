"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  ArrowUpRight,
  BadgeDollarSign,
  BarChart3,
  ChevronDown,
  CircleHelp,
  CreditCard,
  FileText,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Menu,
  Radar,
  RefreshCw,
  ScanSearch,
  Settings,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
import { useState, useTransition } from "react";
import { GlobalSearch } from "@/components/merchant-portal/global-search";
import { cn } from "@/lib/utils";

type NavigationItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  active?: boolean;
};

export function PortalShell({ children, merchantName, merchantId, merchants, userName, adminPortfolio, ownerEarnings, statementsEnabled }: { children: React.ReactNode; merchantName: string; merchantId: string; merchants: Array<{ id: string; businessName: string }>; userName: string; adminPortfolio: boolean; ownerEarnings: boolean; statementsEnabled: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [switching, setSwitching] = useState(false);

  const primaryNavigation: NavigationItem[] = [
    { href: "/dashboard", label: adminPortfolio ? "Portfolio" : "Overview", icon: LayoutDashboard, active: pathname === "/dashboard" && (!adminPortfolio || searchParams.get("view") !== "brand") },
    { href: "/dashboard/payments", label: "Payments", icon: CreditCard },
    { href: "/dashboard/customers", label: "Customers", icon: UsersRound },
    { href: "/dashboard/payouts", label: "Transfers", icon: WalletCards },
    ...(ownerEarnings ? [{ href: "/dashboard/earnings", label: "ORBIT earnings", icon: BadgeDollarSign }] : []),
  ];
  const toolsNavigation: NavigationItem[] = [
    { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
    ...(statementsEnabled ? [{ href: "/dashboard/statements", label: "Statements", icon: FileText }] : []),
    { href: "/dashboard/risk", label: "Risk & disputes", icon: Radar },
    { href: "/dashboard/scans", label: "AI Scanner", icon: ScanSearch },
  ];
  const utilityNavigation: NavigationItem[] = [
    { href: "/dashboard/activity", label: "Activity", icon: Activity },
    { href: "/dashboard/health", label: "Health", icon: HeartPulse },
  ];
  const pageTitle = pathname === "/dashboard"
    ? adminPortfolio && searchParams.get("view") !== "brand" ? "Portfolio" : "Overview"
    : pathname.startsWith("/dashboard/payments") ? "Payments"
      : pathname.startsWith("/dashboard/customers") ? "Customers"
        : pathname.startsWith("/dashboard/payouts") ? "Transfers"
          : pathname.startsWith("/dashboard/statements") ? "Statements"
            : pathname.startsWith("/dashboard/analytics") ? "Analytics"
              : pathname.startsWith("/dashboard/risk") ? "Risk & disputes"
                : pathname.startsWith("/dashboard/activity") ? "Activity"
                  : pathname.startsWith("/dashboard/health") ? "Merchant health"
                    : pathname.startsWith("/dashboard/scans") ? "AI Scanner"
                      : pathname.startsWith("/dashboard/earnings") ? "ORBIT earnings"
                        : pathname.startsWith("/dashboard/settings") ? "Settings"
                          : "Dashboard";

  function isActive(item: NavigationItem) {
    if (item.active !== undefined) return item.active;
    const baseHref = item.href.split("?")[0];
    return baseHref === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(baseHref);
  }

  function navigationItems(items: NavigationItem[]) {
    return items.map((item) => {
      const Icon = item.icon;
      const active = isActive(item);
      return <Link key={item.label} href={item.href} onClick={() => setMobileOpen(false)} aria-current={active ? "page" : undefined} className={cn("group relative mb-1 flex h-10 items-center gap-3 rounded-xl px-3 text-[12px] font-medium", active ? "bg-white/[.055] text-white" : "text-[#858a95] hover:bg-white/[.035] hover:text-[#e7e8ec]")}>
        <span className={cn("absolute inset-y-2 left-0 w-0.5 rounded-full bg-[#8f7dff] transition-opacity", active ? "opacity-100" : "opacity-0")} />
        <Icon className={cn("size-4", active ? "text-[#a89cff]" : "text-[#666c78] group-hover:text-[#9499a3]")} />
        <span className="truncate">{item.label}</span>
      </Link>;
    });
  }

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
    } finally {
      setSwitching(false);
    }
  }

  return <div className="merchant-portal min-h-dvh bg-[#08090e] text-[#f0f1f4]">
    <aside className={cn("fixed inset-y-0 left-0 z-[70] flex w-[236px] flex-col border-r border-white/[.065] bg-[#090a0f] transition-transform lg:translate-x-0", mobileOpen ? "translate-x-0" : "-translate-x-full")}>
      <div className="flex h-16 shrink-0 items-center px-5">
        <Link href="/dashboard" className="flex items-center gap-2.5" onClick={() => setMobileOpen(false)}>
          <span className="grid size-8 place-items-center rounded-[10px] border border-[#8e7dff]/20 bg-[#8e7dff]/10 text-white"><span className="size-2.5 rounded-full border-[3px] border-[#9a8aff]" /></span>
          <span className="text-[14px] font-semibold tracking-[-.02em]">ORBIT</span>
        </Link>
        <button onClick={() => setMobileOpen(false)} className="ml-auto grid size-8 place-items-center rounded-lg text-[#747982] hover:bg-white/[.04] lg:hidden" aria-label="Close navigation"><X className="size-4" /></button>
      </div>

      <div className="px-3 pb-5 pt-2">
        <div className="relative flex w-full items-center gap-3 rounded-xl border border-white/[.07] bg-white/[.025] px-3 py-3" aria-label={`Current business: ${merchantName}`}>
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#7868e8]/15 text-[11px] font-semibold text-[#b4aaff]">{merchantName.slice(0, 2).toUpperCase()}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium text-[#e5e6ea]">{merchantName}</span><span className="mt-0.5 flex items-center gap-1.5 text-[9px] text-[#717682]"><span className="size-1.5 rounded-full bg-[#65d1aa]" />Active account</span></span>
          {merchants.length > 1 && <span className="relative grid size-7 shrink-0 place-items-center rounded-lg text-[#8e939e] hover:bg-white/[.05] hover:text-white">
            <ChevronDown className="size-3.5" />
            <select value={merchantId} disabled={switching} onChange={(event) => void switchMerchant(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Switch merchant account">{merchants.map((merchant) => <option key={merchant.id} value={merchant.id}>{merchant.businessName}</option>)}</select>
          </span>}
        </div>
        {adminPortfolio && <Link href="/dashboard?view=brand" onClick={() => setMobileOpen(false)} className="mt-2 flex h-8 items-center justify-between rounded-lg px-3 text-[10px] text-[#737985] hover:bg-white/[.03] hover:text-[#b7adfb]"><span>Open selected account</span><ArrowUpRight className="size-3" /></Link>}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="Merchant portal navigation">
        <section className="mb-5" aria-label="Main navigation"><p className="mb-2 px-3 text-[9px] font-semibold uppercase tracking-[.12em] text-[#565c68]">Main</p>{navigationItems(primaryNavigation)}</section>
        <section aria-label="Tools navigation"><p className="mb-2 px-3 text-[9px] font-semibold uppercase tracking-[.12em] text-[#565c68]">Tools</p>{navigationItems(toolsNavigation)}</section>
      </nav>

      <div className="mt-auto border-t border-white/[.055] px-3 pb-3 pt-3">
        <div className="grid grid-cols-2 gap-1">{utilityNavigation.map((item) => { const Icon = item.icon; const active = isActive(item); return <Link key={item.label} href={item.href} onClick={() => setMobileOpen(false)} aria-current={active ? "page" : undefined} className={cn("flex h-9 items-center justify-center gap-2 rounded-lg text-[10px]", active ? "bg-[#8f7dff]/10 text-[#b5abfb]" : "text-[#717783] hover:bg-white/[.035] hover:text-white")}><Icon className="size-3.5" />{item.label}</Link>; })}</div>
        <div className="mt-1 grid grid-cols-2 gap-1">
          <Link href="/dashboard/settings" onClick={() => setMobileOpen(false)} className="flex h-9 items-center justify-center gap-2 rounded-lg text-[10px] text-[#717783] hover:bg-white/[.035] hover:text-white"><Settings className="size-3.5" />Settings</Link>
          <Link href="/contact" className="flex h-9 items-center justify-center gap-2 rounded-lg text-[10px] text-[#717783] hover:bg-white/[.035] hover:text-white"><CircleHelp className="size-3.5" />Support</Link>
        </div>
        <div className="mt-2 flex items-center gap-2 border-t border-white/[.055] px-2 pt-3"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#7868e8]/15 text-[10px] font-semibold text-[#b3a9ff]">{userName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span className="min-w-0 flex-1 truncate text-[11px] text-[#858a95]">{userName}</span><button onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }} className="grid size-8 place-items-center rounded-lg text-[#656a76] hover:bg-white/[.05] hover:text-white" aria-label="Sign out"><LogOut className="size-3.5" /></button></div>
      </div>
    </aside>

    {mobileOpen && <button className="fixed inset-0 z-[65] bg-black/45 backdrop-blur-[2px] lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" />}
    <div className="lg:pl-[236px]">
      <header className="sticky top-0 z-50 flex h-16 items-center border-b border-white/[.065] bg-[#08090e]/90 px-4 backdrop-blur-xl sm:px-7 lg:px-8">
        <button onClick={() => setMobileOpen(true)} className="mr-3 grid size-9 place-items-center rounded-[10px] border border-white/[.08] bg-white/[.025] text-[#8b909b] lg:hidden" aria-label="Open navigation"><Menu className="size-4" /></button>
        <div className="min-w-0"><p className="truncate text-[13px] font-medium text-[#e5e6ea]">{pageTitle}</p><p className="mt-0.5 hidden truncate text-[9px] text-[#626874] sm:block">{pageTitle === "Portfolio" ? "All authorized accounts" : merchantName}</p></div>
        <div className="ml-auto flex items-center gap-2"><span className="mr-1 hidden items-center gap-1.5 text-[9px] text-[#717782] md:inline-flex"><span className="size-1.5 rounded-full bg-[#65d1aa]" />Live</span><GlobalSearch /><button onClick={refresh} disabled={refreshing} className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-white/[.08] bg-white/[.025] px-3 text-[11px] font-medium text-[#a6aab3] hover:border-[#7868e8]/30 hover:bg-[#7868e8]/[.06] disabled:opacity-60"><RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} /><span className="hidden sm:inline">{refreshing ? "Refreshing" : "Refresh"}</span></button></div>
      </header>
      <main>{children}</main>
    </div>
  </div>;
}
