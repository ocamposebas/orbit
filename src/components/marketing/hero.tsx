import { ButtonLink } from "@/components/ui/button-link";

export function Hero() {
  return (
    <section className="border-b border-white/[.07] bg-[#090a0c] pb-20 pt-36 sm:pb-28 sm:pt-44">
      <div className="container-shell">
        <div className="max-w-4xl">
          <p className="eyebrow">Merchant compliance intelligence</p>
          <h1 className="mt-7 max-w-4xl text-balance text-[clamp(3rem,7vw,6.5rem)] font-medium leading-[.92] tracking-[-.065em]">Know exactly where merchant risk lives.</h1>
          <p className="mt-7 max-w-2xl text-balance text-base leading-8 text-[#92959d] sm:text-lg">ORBIT investigates merchant websites, preserves evidence, identifies compliance gaps, and produces a clear operating record for risk teams.</p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/request-access">Request access</ButtonLink>
            <ButtonLink href="/product" variant="secondary">View the platform</ButtonLink>
          </div>
        </div>
        <div className="mt-20 grid border-y border-white/[.08] sm:grid-cols-3">
          {[['01','Website investigation'],['02','Evidence-backed findings'],['03','Continuous monitoring']].map(([number,label]) => <div key={number} className="flex items-center gap-4 border-b border-white/[.08] py-5 last:border-b-0 sm:border-b-0 sm:border-r sm:px-6 sm:first:pl-0 sm:last:border-r-0"><span className="font-mono text-[9px] text-[#6f72dd]">{number}</span><span className="text-xs text-[#a7aab1]">{label}</span></div>)}
        </div>
      </div>
    </section>
  );
}
