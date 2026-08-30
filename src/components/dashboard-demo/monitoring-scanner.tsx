"use client";

import { motion } from "framer-motion";
import { Check, FileText, Globe2, ScanSearch } from "lucide-react";
import { StatusPill } from "./status-pill";

const metrics = [["Pages analyzed", "147"], ["Products detected", "83"], ["Policies", "6"], ["New changes", "3"], ["Critical findings", "0"], ["Warnings", "2"]];

export function MonitoringScanner() {
  return (
    <div className="panel overflow-hidden rounded-[6px]">
      <div className="flex items-center justify-between border-b border-white/[.08] px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2"><ScanSearch className="size-4 text-[#ff7458]"/><span className="text-xs font-medium">Website scanner</span></div>
        <StatusPill tone="success"><motion.span animate={{ opacity: [.3, 1, .3] }} transition={{ duration: 2.2, repeat: Infinity }} className="size-1.5 rounded-full bg-[#78d6ad]"/> Live</StatusPill>
      </div>
      <div className="grid lg:grid-cols-[1.35fr_.85fr]">
        <div className="relative min-h-[370px] overflow-hidden border-b border-white/[.08] bg-[#0a0c0f] p-4 sm:p-6 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2 rounded-lg border border-white/[.08] bg-white/[.025] px-3 py-2"><Globe2 className="size-3.5 text-[#6f727b]"/><span className="font-mono text-[10px] text-[#8b8e97]">https://northstar.example</span><span className="ml-auto size-1.5 rounded-full bg-[#78d6ad]"/></div>
          <div className="relative mt-5 overflow-hidden rounded-lg border border-white/[.07] bg-[#0e1014]">
            <div className="h-8 border-b border-white/[.06] bg-white/[.018]"/>
            <div className="grid grid-cols-[80px_1fr] gap-4 p-4 sm:grid-cols-[110px_1fr]">
              <div className="space-y-2"><div className="h-2 w-14 rounded bg-white/[.07]"/><div className="h-2 w-20 rounded bg-white/[.04]"/><div className="h-2 w-16 rounded bg-white/[.04]"/></div>
              <div><div className="h-3 w-2/5 rounded bg-white/[.09]"/><div className="mt-3 h-2 w-full rounded bg-white/[.045]"/><div className="mt-2 h-2 w-4/5 rounded bg-white/[.045]"/><div className="mt-6 grid grid-cols-3 gap-2">{[1,2,3].map((n) => <div key={n} className="aspect-[1.2] rounded border border-white/[.06] bg-white/[.025]"/>)}</div><div className="mt-5 h-2 w-3/4 rounded bg-white/[.04]"/></div>
            </div>
            <motion.div animate={{ top: ["12%", "90%", "12%"] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }} className="absolute inset-x-0 top-0 h-px bg-[#ff6547] shadow-[0_0_16px_2px_rgba(255,101,71,.55)]" />
          </div>
          <div className="mt-4 flex items-center gap-2 text-[10px] text-[#80838c]"><motion.span animate={{ rotate: 360 }} transition={{ duration: 3, repeat: Infinity, ease: "linear" }} className="block size-3 rounded-full border border-[#ff6547]/30 border-t-[#ff8068]"/>Scanning merchant website...</div>
        </div>
        <div className="p-4 sm:p-6">
          <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#646771]">Current scan</p>
          <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/[.07] bg-white/[.07] lg:grid-cols-1">
            {metrics.map(([label, value], index) => <div key={label} className="flex flex-col bg-[#101216] px-3 py-3 sm:flex-row sm:items-center sm:justify-between"><span className="text-[10px] text-[#797c85]">{label}</span><motion.span initial={{ opacity: 0, y: 6 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: index * .07 }} className={`number-tabular mt-1 text-sm font-medium sm:mt-0 ${label === "Critical findings" ? "text-[#78d6ad]" : label === "Warnings" ? "text-[#e7c98d]" : "text-[#e7e5e0]"}`}>{value}</motion.span></div>)}
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-[#78d6ad]/15 bg-[#78d6ad]/[.04] p-3 text-[10px] text-[#9baea6]"><Check className="size-3.5 text-[#78d6ad]"/><FileText className="size-3.5 text-[#7c7f88]"/>Robots and policy routes detected</div>
        </div>
      </div>
    </div>
  );
}
