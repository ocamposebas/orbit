import { AlertTriangle, Check, CircleDot, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export function HealthRing({ value, size = "large" }: { value: number; size?: "small" | "large" }) {
  const radius = 43; const circumference = 2 * Math.PI * radius;
  return <div className={cn("relative grid shrink-0 place-items-center", size === "large" ? "size-32" : "size-12")}><svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90"><circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth={size === "large" ? 4 : 6} /><circle cx="50" cy="50" r={radius} fill="none" stroke="#7f82f5" strokeWidth={size === "large" ? 4 : 6} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value / 100)} /></svg><span className={cn("font-medium tracking-[-.06em]", size === "large" ? "text-4xl" : "text-sm")}>{value}</span></div>;
}

const tones: Record<string, string> = { CRITICAL: "border-[#e77878]/25 bg-[#e77878]/8 text-[#e99b9b]", HIGH: "border-[#df9771]/25 bg-[#df9771]/8 text-[#e6a989]", MEDIUM: "border-[#d9b96f]/25 bg-[#d9b96f]/8 text-[#dbc486]", LOW: "border-[#6f9acb]/25 bg-[#6f9acb]/8 text-[#8db0d7]", INFO: "border-white/10 bg-white/[.03] text-[#8b8f98]" };
export function Severity({ value }: { value: string }) { return <span className={cn("inline-flex rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-[.1em]", tones[value] ?? tones.INFO)}>{value}</span>; }

export function EmptyState({ title, detail }: { title: string; detail: string }) { return <div className="grid min-h-48 place-items-center border border-dashed border-white/[.1] p-8 text-center"><div><div className="mx-auto grid size-8 place-items-center rounded-full border border-white/[.09] text-[#6d7179]"><Minus className="size-3.5" /></div><p className="mt-3 text-sm text-[#caccc7]">{title}</p><p className="mt-1 max-w-sm text-xs leading-5 text-[#676b74]">{detail}</p></div></div>; }

export function StatusIcon({ status }: { status: string }) { if (status === "COMPLETED") return <Check className="size-3.5 text-[#72c7a1]" />; if (status === "FAILED") return <AlertTriangle className="size-3.5 text-[#dc8585]" />; return <CircleDot className="size-3.5 text-[#8588f0]" />; }
