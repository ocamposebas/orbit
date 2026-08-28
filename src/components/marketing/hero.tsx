import { ButtonLink } from "@/components/ui/button-link";
import { Check, Eye, ScanSearch } from "lucide-react";

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden border-b border-white/[.07] bg-[#08090b] pb-20 pt-32 sm:pb-28 sm:pt-40">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_76%_42%,rgba(111,104,255,.14),transparent_26%),radial-gradient(circle_at_76%_42%,rgba(81,191,153,.05),transparent_44%)]"/>
      <div className="absolute inset-0 -z-10 opacity-[.16] [background-image:linear-gradient(rgba(255,255,255,.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.055)_1px,transparent_1px)] [background-size:72px_72px] [mask-image:linear-gradient(to_right,transparent,black_58%,black)]"/>
      <div className="container-shell">
        <div className="grid gap-16 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
        <div className="max-w-4xl">
          <p className="eyebrow">Merchant compliance intelligence</p>
          <h1 className="mt-7 max-w-4xl text-balance text-[clamp(3rem,7vw,6.5rem)] font-medium leading-[.92] tracking-[-.065em]">Know exactly where merchant risk lives.</h1>
          <p className="mt-7 max-w-2xl text-balance text-base leading-8 text-[#92959d] sm:text-lg">ORBIT investigates merchant websites, preserves evidence, identifies compliance gaps, and produces a clear operating record for risk teams.</p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/request-access">Request access</ButtonLink>
            <ButtonLink href="/product" variant="secondary">View the platform</ButtonLink>
          </div>
        </div>
        <div className="relative mx-auto hidden aspect-square w-full max-w-[520px] lg:block" aria-hidden="true">
          <div className="absolute inset-[7%] rounded-full border border-white/[.07]"/>
          <div className="absolute inset-[18%] rounded-full border border-[#8988ff]/20 shadow-[0_0_80px_rgba(112,105,255,.12)]"/>
          <div className="absolute inset-[30%] rounded-full border border-white/[.1] bg-[#101218]/80 shadow-[0_24px_100px_rgba(0,0,0,.6)] backdrop-blur-xl"/>
          <div className="absolute inset-[36%] grid place-items-center rounded-full border border-[#8988ff]/25 bg-[#7775ef]/[.08] shadow-[inset_0_0_40px_rgba(117,113,239,.08),0_0_50px_rgba(117,113,239,.12)]"><ScanSearch className="size-10 text-[#aaa9ff]"/></div>
          <div className="absolute left-1/2 top-[7%] h-[43%] w-px origin-bottom animate-[spin_7s_linear_infinite] bg-gradient-to-t from-[#8d8aff] via-[#8d8aff]/35 to-transparent shadow-[0_0_18px_rgba(141,138,255,.8)]"/>
          <div className="absolute left-[5%] top-[28%] w-44 rounded-xl border border-white/[.09] bg-[#0d0f14]/90 p-4 shadow-2xl backdrop-blur-xl animate-[pulse_5s_ease-in-out_infinite]"><div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[.14em] text-[#747985]"><Eye className="size-3 text-[#8f91f6]"/> Evidence retained</div><p className="mt-3 text-xs text-[#d0d2ce]">Canonical page verified</p><div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full w-[82%] rounded-full bg-[#7779eb]"/></div></div>
          <div className="absolute bottom-[15%] right-[1%] w-48 rounded-xl border border-[#72d0aa]/15 bg-[#0d0f14]/90 p-4 shadow-2xl backdrop-blur-xl animate-[pulse_6s_ease-in-out_1s_infinite]"><div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[.14em] text-[#747985]"><Check className="size-3 text-[#7bd4af]"/> Review complete</div><p className="mt-3 text-xs text-[#d0d2ce]">Policy coverage mapped</p><p className="mt-1 font-mono text-[9px] text-[#60656e]">Source-backed assessment</p></div>
          <span className="absolute right-[14%] top-[20%] size-2 rounded-full bg-[#8e8cff] shadow-[0_0_18px_5px_rgba(142,140,255,.55)]"/>
          <span className="absolute bottom-[24%] left-[17%] size-1.5 rounded-full bg-[#76d0ac] shadow-[0_0_16px_4px_rgba(118,208,172,.45)]"/>
        </div>
        </div>
        <div className="mt-20 grid border-y border-white/[.08] sm:grid-cols-3">
          {[['01','Website investigation'],['02','Evidence-backed findings'],['03','Continuous monitoring']].map(([number,label]) => <div key={number} className="flex items-center gap-4 border-b border-white/[.08] py-5 last:border-b-0 sm:border-b-0 sm:border-r sm:px-6 sm:first:pl-0 sm:last:border-r-0"><span className="font-mono text-[9px] text-[#6f72dd]">{number}</span><span className="text-xs text-[#a7aab1]">{label}</span></div>)}
        </div>
      </div>
    </section>
  );
}
