"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, Bell, Boxes, ChevronDown, FileClock, LogOut, Menu, Radar, Search, Settings, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { SentinelRoleProvider } from "./auth-context";

const links = [
  { href: "/sentinel", label: "Watchtower", icon: Radar },
  { href: "/sentinel#merchants", label: "Merchants", icon: Boxes },
  { href: "/sentinel#review", label: "Review queue", icon: ShieldCheck },
  { href: "/sentinel#activity", label: "Activity", icon: Activity },
  { href: "/sentinel#rules", label: "Rulesets", icon: FileClock },
];

export function SentinelShell({ children, workspace, userName, role }: { children: React.ReactNode; workspace: string; userName: string; role: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return <div className="min-h-dvh bg-[#090b0e] text-[#ecede9]">
    <header className="fixed inset-x-0 top-0 z-50 flex h-14 items-center border-b border-white/[.07] bg-[#090b0e]/95 px-4 backdrop-blur md:left-[228px] md:px-7">
      <button onClick={() => setOpen(true)} className="mr-3 grid size-8 place-items-center rounded-md border border-white/10 md:hidden" aria-label="Open navigation"><Menu className="size-4" /></button>
      <div className="flex min-w-0 items-center gap-2 text-[12px] text-[#777b84]"><span className="hidden sm:inline">ORBIT Sentinel</span><span className="hidden text-[#3f434b] sm:inline">/</span><span className="truncate text-[#c8cac5]">{pathname.includes("/merchant/") ? "Merchant intelligence" : pathname.includes("/scan/") ? "Live scan" : "Watchtower"}</span></div>
      <div className="ml-auto flex items-center gap-2">
        <button className="hidden h-8 items-center gap-2 rounded-md border border-white/[.08] bg-white/[.025] px-3 text-[11px] text-[#888c94] sm:flex"><Search className="size-3.5" /> Search <kbd className="ml-2 font-mono text-[9px] text-[#555962]">⌘K</kbd></button>
        <button className="grid size-8 place-items-center rounded-md border border-white/[.08] text-[#888c94]" aria-label="Notifications"><Bell className="size-3.5" /></button>
        <button className="flex h-8 items-center gap-2 rounded-md border border-white/[.08] px-2 text-[11px]"><span className="grid size-4 place-items-center rounded bg-[#7274ea] text-[8px] font-bold">{workspace.slice(0, 1).toUpperCase()}</span><span className="hidden sm:inline">{workspace}</span><ChevronDown className="size-3 text-[#666a72]" /></button>
      </div>
    </header>
    <aside className={cn("fixed inset-y-0 left-0 z-[60] w-[228px] border-r border-white/[.07] bg-[#0a0c0f] transition-transform md:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
      <div className="flex h-14 items-center border-b border-white/[.07] px-5"><Link href="/" className="text-[14px] font-semibold tracking-[-.03em]">ORBIT</Link><span className="ml-2 rounded border border-[#7779ec]/25 bg-[#7779ec]/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[.14em] text-[#9a9cf3]">Sentinel</span><button onClick={() => setOpen(false)} className="ml-auto md:hidden" aria-label="Close navigation"><X className="size-4" /></button></div>
      <nav className="p-3" aria-label="Sentinel navigation">{links.map((item) => { const active = item.href === "/sentinel" ? pathname === "/sentinel" : false; const Icon = item.icon; return <Link onClick={() => setOpen(false)} key={item.label} href={item.href} className={cn("mb-0.5 flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[12px] transition-colors", active ? "bg-white/[.065] text-[#eceeea]" : "text-[#777b84] hover:bg-white/[.035] hover:text-[#c7c9c5]")}><Icon className={cn("size-3.5", active && "text-[#9294ff]")} />{item.label}</Link>; })}</nav>
      <div className="absolute inset-x-3 bottom-3 border-t border-white/[.07] pt-3">{["OWNER", "ADMIN"].includes(role) && <Link href="/sentinel/users" className="flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[12px] text-[#72767f] hover:bg-white/[.035]"><Settings className="size-3.5" />Users & roles</Link>}<div className="mt-2 flex items-center gap-1"><Link href="/sentinel/profile" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 hover:bg-white/[.035]"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#20242a] text-[10px]">{userName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-[11px] text-[#c8cac6]">{userName}</span><span className="block text-[9px] uppercase tracking-wider text-[#5c6068]">{role.replaceAll("_", " ")}</span></span></Link><button onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }} className="grid size-7 shrink-0 place-items-center rounded text-[#60646c] hover:bg-white/[.04] hover:text-white" aria-label="Sign out"><LogOut className="size-3.5" /></button></div></div>
    </aside>
    {open && <button aria-label="Close navigation overlay" onClick={() => setOpen(false)} className="fixed inset-0 z-[55] bg-black/60 md:hidden" />}
    <div className="pt-14 md:pl-[228px]"><SentinelRoleProvider role={role}>{children}</SentinelRoleProvider></div>
  </div>;
}
