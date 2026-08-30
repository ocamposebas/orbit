import { AlertTriangle, ArrowRight, FileCode2 } from "lucide-react";
import { StatusPill } from "./status-pill";

export function ChangeDiff() {
  return (
    <div className="panel overflow-hidden rounded-[6px]">
      <div className="flex items-center justify-between border-b border-white/[.08] px-4 py-3 sm:px-6"><div className="flex items-center gap-2"><FileCode2 className="size-4 text-[#a78bfa]"/><span className="text-xs font-medium">Content change</span></div><span className="font-mono text-[9px] text-[#60636b]">/products/research-alpha</span></div>
      <div className="grid lg:grid-cols-2">
        <div className="border-b border-white/[.08] p-5 sm:p-7 lg:border-b-0 lg:border-r"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#656871]">Before</p><div className="mt-5 font-mono text-xs leading-7 text-[#9699a1]"><span className="mr-4 text-[#4d5058]">18</span>Research material intended for<br/><span className="mr-4 text-[#4d5058]">19</span>laboratory analysis.</div><div className="mt-6 border-l-2 border-[#e68181]/55 bg-[#e68181]/[.055] px-4 py-3 font-mono text-[11px] text-[#c69292]"><span className="mr-3 text-[#8d5f5f]">−</span>Research material intended for laboratory analysis.</div></div>
        <div className="p-5 sm:p-7"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#656871]">After</p><div className="mt-5 font-mono text-xs leading-7 text-[#c0c2c8]"><span className="mr-4 text-[#4d5058]">18</span>Supports rapid fat loss and<br/><span className="mr-4 text-[#4d5058]">19</span>increases metabolism.</div><div className="mt-6 border-l-2 border-[#78d6ad]/55 bg-[#78d6ad]/[.05] px-4 py-3 font-mono text-[11px] text-[#9ac9b5]"><span className="mr-3 text-[#5b9079]">+</span>Supports rapid fat loss and increases metabolism.</div></div>
      </div>
      <div className="border-t border-white/[.08] bg-black/10 p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#e7bd72]/[.08]"><AlertTriangle className="size-4 text-[#e7bd72]"/></span><div className="flex-1"><p className="text-xs font-medium">Potential consumer-directed efficacy claim detected</p><p className="mt-1 text-[10px] leading-5 text-[#747781]">Review against the merchant’s declared business model and applicable monitoring rules.</p></div><div className="flex items-center gap-2"><span className="text-[9px] uppercase tracking-[.12em] text-[#666a73]">Risk impact</span><ArrowRight className="size-3 text-[#555860]"/><StatusPill tone="warning">High</StatusPill></div></div>
      </div>
    </div>
  );
}
