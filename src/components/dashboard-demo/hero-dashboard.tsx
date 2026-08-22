"use client";

import { motion } from "framer-motion";
import { Activity, Bell, Check, ChevronDown, CircleGauge, FileSearch, Globe2, MoreHorizontal, Search, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { StatusPill } from "./status-pill";

const nav = [
  { icon: CircleGauge, label: "Overview", active: true },
  { icon: Globe2, label: "Monitoring" },
  { icon: FileSearch, label: "Findings", count: 2 },
  { icon: Activity, label: "Activity" },
];

export function HeroDashboard() {
  return (
    <motion.div initial={{ opacity: 0, y: 44, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .9, delay: .45, ease: [0.16, 1, 0.3, 1] }} className="relative mx-auto mt-16 max-w-[1080px] sm:mt-20">
      <div className="absolute -inset-16 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(112,114,220,.13),transparent_60%)]" />
      <div className="panel overflow-hidden rounded-[15px]">
        <div className="flex h-12 items-center border-b border-white/[.08] px-3.5 sm:px-5">
          <div className="flex items-center gap-1.5" aria-hidden="true"><span className="size-2 rounded-full bg-white/15"/><span className="size-2 rounded-full bg-white/10"/><span className="size-2 rounded-full bg-white/[.07]"/></div>
          <div className="mx-auto rounded-md border border-white/[.07] bg-black/20 px-5 py-1 font-mono text-[9px] text-[#666a73]">app.orbit / demo</div>
          <MoreHorizontal className="size-4 text-white/20" aria-hidden="true" />
        </div>
        <div className="grid min-h-[525px] grid-cols-1 md:grid-cols-[190px_1fr]">
          <aside className="hidden border-r border-white/[.08] bg-black/10 p-4 md:flex md:flex-col">
            <Logo />
            <div className="mt-8 space-y-1">
              {nav.map(({ icon: Icon, label, active, count }) => (
                <div key={label} className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[11px] ${active ? "bg-white/[.065] text-[#eeece7]" : "text-[#747781]"}`}>
                  <Icon className="size-3.5" /><span>{label}</span>{count && <span className="ml-auto rounded bg-[#8b8cff]/15 px-1.5 py-0.5 text-[9px] text-[#a9aaff]">{count}</span>}
                </div>
              ))}
            </div>
            <div className="mt-auto rounded-lg border border-white/[.07] p-3">
              <p className="text-[9px] uppercase tracking-[.13em] text-[#62656d]">Workspace</p>
              <div className="mt-2 flex items-center gap-2"><span className="grid size-6 place-items-center rounded bg-[#8b8cff]/15 text-[9px] font-semibold text-[#b5b6ff]">DM</span><span className="text-[10px] text-[#b2b4ba]">Demo Merchant</span></div>
            </div>
          </aside>
          <div className="min-w-0 bg-[#0d0f12]">
            <div className="flex h-14 items-center justify-between border-b border-white/[.07] px-4 sm:px-6">
              <div className="flex items-center gap-2 text-[11px] text-[#8c8f97]"><span>Demo Merchant</span><ChevronDown className="size-3" /></div>
              <div className="flex items-center gap-3"><Search className="size-3.5 text-[#666a73]"/><Bell className="size-3.5 text-[#666a73]"/><div className="size-6 rounded-full border border-white/10 bg-white/[.05]"/></div>
            </div>
            <div className="p-4 sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div><div className="flex items-center gap-2"><h3 className="text-lg font-medium tracking-[-.03em]">Northstar Labs</h3><StatusPill tone="accent">Demo workspace</StatusPill></div><p className="mt-1 text-[10px] text-[#6e717a]">northstarlabs.example · Illustrative data</p></div>
                <p className="text-[10px] text-[#686b73]">Last scan <span className="text-[#b9bbc1]">18 min ago</span></p>
              </div>
              <div className="mt-5 grid gap-3 lg:grid-cols-[1.15fr_1fr]">
                <div className="rounded-xl border border-white/[.08] bg-white/[.018] p-4 sm:p-5">
                  <div className="flex items-start justify-between"><div><p className="text-[10px] uppercase tracking-[.12em] text-[#696c75]">ORBIT Health Score</p><p className="mt-3 text-xs text-[#92959e]">Internal monitoring indicator</p></div><StatusPill tone="success"><span className="size-1 rounded-full bg-[#78d6ad]"/> Healthy</StatusPill></div>
                  <div className="mt-6 flex items-end gap-4"><span className="number-tabular text-6xl font-medium tracking-[-.07em]">94</span><span className="mb-2 text-xs text-[#646771]">/ 100</span></div>
                  <div className="mt-5 h-1 overflow-hidden rounded-full bg-white/[.06]"><motion.div initial={{ width: 0 }} whileInView={{ width: "94%" }} viewport={{ once: true }} transition={{ duration: 1.2, delay: .7 }} className="h-full rounded-full bg-gradient-to-r from-[#6e70d8] to-[#8fd6d4]" /></div>
                </div>
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/[.08] bg-white/[.08]">
                  {[["Critical findings", "0", "Clear"], ["Warnings", "2", "Review"], ["Policies", "6/6", "Covered"], ["Changes", "3", "This week"]].map(([label,value,note]) => <div key={label} className="bg-[#101216] p-4"><p className="text-[9px] leading-4 text-[#6f727b]">{label}</p><p className="number-tabular mt-3 text-xl font-medium">{value}</p><p className="mt-1 text-[9px] text-[#666a73]">{note}</p></div>)}
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="flex items-center justify-between rounded-lg border border-white/[.07] px-4 py-3"><div className="flex items-center gap-3"><span className="grid size-7 place-items-center rounded-md bg-[#78d6ad]/[.08]"><Globe2 className="size-3.5 text-[#78d6ad]"/></span><div><p className="text-[10px] text-[#747781]">Website monitoring</p><p className="mt-0.5 text-xs">Active</p></div></div><span className="size-1.5 rounded-full bg-[#78d6ad] shadow-[0_0_9px_#78d6ad]"/></div>
                <div className="flex items-center justify-between rounded-lg border border-white/[.07] px-4 py-3"><div className="flex items-center gap-3"><span className="grid size-7 place-items-center rounded-md bg-[#8b8cff]/[.09]"><ShieldCheck className="size-3.5 text-[#a9aaff]"/></span><div><p className="text-[10px] text-[#747781]">Review status</p><p className="mt-0.5 text-xs">Current</p></div></div><Check className="size-3.5 text-[#78d6ad]"/></div>
              </div>
              <div className="mt-3 overflow-hidden rounded-lg border border-white/[.07]">
                <div className="flex items-center justify-between border-b border-white/[.07] px-4 py-2.5"><span className="text-[10px] font-medium">Recent signals</span><span className="text-[9px] text-[#666a73]">Live view</span></div>
                {[{label:"Refund policy language updated",time:"18m",tone:"Medium"},{label:"Scheduled website scan completed",time:"18m",tone:"Clear"}].map((item) => <div key={item.label} className="flex items-center gap-3 border-b border-white/[.05] px-4 py-2.5 last:border-0"><span className="size-1.5 rounded-full bg-[#8b8cff]"/><span className="min-w-0 flex-1 truncate text-[10px] text-[#a9abb2]">{item.label}</span><span className="hidden text-[9px] text-[#696c75] sm:inline">{item.tone}</span><span className="font-mono text-[9px] text-[#565961]">{item.time}</span></div>)}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-10 -bottom-10 -z-10 h-20 bg-[#8b8cff]/10 blur-3xl" />
    </motion.div>
  );
}
