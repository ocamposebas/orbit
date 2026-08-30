import { BadgeCheck, CircleCheck, FileCheck2, Globe2, ShieldCheck } from "lucide-react";
import { StatusPill } from "./status-pill";

const stats = [
  { label: "Policy coverage", value: "100%", note: "6 of 6 detected", icon: FileCheck2 },
  { label: "Monitoring", value: "Active", note: "Last scan 18m ago", icon: Globe2 },
  { label: "Open findings", value: "2", note: "0 critical", icon: ShieldCheck },
];

export function HealthDashboard() {
  return (
    <div className="panel rounded-[6px] p-4 sm:p-7">
      <div className="flex flex-col gap-4 border-b border-white/[.08] pb-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs text-[#747781]">Merchant health</p><h3 className="mt-1 text-xl font-medium">Northstar Labs</h3></div><StatusPill tone="accent">Illustrative data</StatusPill></div>
      <div className="grid gap-3 py-5 lg:grid-cols-[1.1fr_1.9fr]">
        <div className="rounded-[5px] border border-white/[.08] bg-black/10 p-5">
          <p className="text-[10px] uppercase tracking-[.13em] text-[#70737c]">ORBIT Health Score</p>
          <div className="mt-5 flex items-end"><span className="number-tabular text-7xl font-medium">94</span><span className="mb-3 text-sm text-[#686b74]">/100</span></div>
          <p className="mt-4 text-[10px] leading-5 text-[#696c75]">Internal ORBIT indicator based on monitored website, policy, and review signals.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {stats.map(({label,value,note,icon:Icon}) => <div key={label} className="rounded-[5px] border border-white/[.08] p-4"><Icon className="size-4 text-[#a78bfa]"/><p className="mt-7 text-[10px] text-[#757881]">{label}</p><p className="mt-1 text-lg font-medium">{value}</p><p className="mt-1 text-[9px] text-[#60636b]">{note}</p></div>)}
        </div>
      </div>
      <div className="grid gap-px overflow-hidden rounded-xl border border-white/[.08] bg-white/[.07] sm:grid-cols-3">
        {[
          {label:"Business verification",value:"Complete",icon:BadgeCheck},
          {label:"Review status",value:"Current",icon:ShieldCheck},
          {label:"Critical findings",value:"0",icon:CircleCheck},
        ].map(({label,value,icon:Icon}) => <div key={label} className="flex items-center gap-3 bg-[#0e1013] p-4"><span className="grid size-8 place-items-center rounded-lg bg-[#78d6ad]/[.07]"><Icon className="size-4 text-[#78d6ad]"/></span><div><p className="text-[9px] text-[#696c75]">{label}</p><p className="mt-0.5 text-xs">{value}</p></div></div>)}
      </div>
    </div>
  );
}
