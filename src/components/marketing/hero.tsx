import { ButtonLink } from "@/components/ui/button-link";
import { ArrowDown, Check, Crosshair, FileText, Radar, ShieldAlert } from "lucide-react";

const signals = [
  { icon: ShieldAlert, label: "New efficacy claim", meta: "/products/research-alpha", tone: "alert" },
  { icon: FileText, label: "Refund policy changed", meta: "/policies/refunds", tone: "neutral" },
  { icon: Check, label: "Evidence preserved", meta: "Snapshot 08:42 UTC", tone: "success" },
] as const;

export function Hero() {
  return (
    <section className="orbit-hero relative isolate min-h-[min(940px,100svh)] overflow-hidden border-b border-white/[.09] pt-14">
      <div className="container-shell relative z-10 flex min-h-[calc(min(940px,100svh)-56px)] flex-col">
        <div className="grid flex-1 items-center gap-12 pb-14 pt-16 lg:grid-cols-[1.05fr_.95fr] lg:pb-20 lg:pt-20">
          <div className="max-w-4xl">
            <div className="flex items-center gap-3 text-[10px] font-medium uppercase text-[#b2b3c8]">
              <span className="size-1.5 rounded-full bg-[#8b6cff] shadow-[0_0_18px_4px_rgba(124,92,255,.38)]" />
              Merchant risk intelligence
              <span className="h-px w-10 bg-white/15" />
              Always in motion
            </div>

            <h1 className="mt-8 text-[5.25rem] font-semibold leading-[.72] text-[#f5f4ff] sm:text-[8.5rem] xl:text-[11rem]">ORBIT</h1>
            <div className="mt-10 max-w-2xl border-l border-[#8b6cff]/75 pl-5 sm:mt-12 sm:pl-7">
              <p className="text-balance text-2xl font-medium leading-[1.08] text-[#f5f4ff] sm:text-4xl">
                See merchant risk before it becomes disruption.
              </p>
              <p className="mt-5 max-w-xl text-pretty text-sm leading-7 text-[#999bb3] sm:text-base">
                ORBIT continuously investigates merchant websites, detects material changes, preserves source evidence, and gives risk teams a defensible record of what happened next.
              </p>
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/request-access">Request access</ButtonLink>
              <ButtonLink href="#how-it-works" variant="secondary">See how it works</ButtonLink>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[520px] self-end lg:mx-0 lg:justify-self-end lg:self-center">
            <div className="overflow-hidden border border-white/[.12] bg-[#080a18]/88 shadow-[0_32px_100px_rgba(0,0,0,.5)] backdrop-blur-xl">
              <div className="flex h-12 items-center gap-3 border-b border-white/[.09] px-4">
                <Crosshair className="size-3.5 text-[#a78bfa]" />
                <span className="text-[10px] font-medium uppercase text-[#c0c1d2]">Live investigation</span>
                <span className="ml-auto flex items-center gap-2 font-mono text-[9px] text-[#74768d]"><span className="size-1.5 rounded-full bg-[#6ee7c3]" /> ACTIVE</span>
              </div>

              <div className="relative min-h-[220px] overflow-hidden border-b border-white/[.09] p-5 sm:min-h-[250px] sm:p-6">
                <div className="absolute inset-0 surface-grid opacity-50" />
                <div className="relative flex items-start justify-between gap-4">
                  <div>
                    <p className="font-mono text-[9px] uppercase text-[#6c6e86]">Monitored surface</p>
                    <p className="mt-2 text-sm font-medium text-[#e8e5de]">northstarlabs.example</p>
                  </div>
                  <Radar className="size-5 text-[#a78bfa]" />
                </div>

                <div className="relative mt-8 grid grid-cols-[1fr_auto] items-end gap-5">
                  <div>
                    <p className="font-mono text-[3.5rem] font-medium leading-none text-[#f5f4ff] sm:text-[4.5rem]">147</p>
                    <p className="mt-2 text-[10px] uppercase text-[#797b94]">Pages analyzed</p>
                  </div>
                  <div className="pb-1 text-right">
                    <p className="font-mono text-2xl text-[#a78bfa]">02</p>
                    <p className="mt-2 text-[9px] uppercase text-[#797b94]">Need review</p>
                  </div>
                </div>

                <div className="relative mt-6 h-px overflow-hidden bg-white/[.08]"><span className="block h-full w-[78%] bg-[#7c5cff] shadow-[0_0_16px_#7c5cff]" /></div>
              </div>

              <div>
                {signals.map(({ icon: Icon, label, meta, tone }) => (
                  <div key={label} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 border-b border-white/[.07] px-4 py-3.5 last:border-b-0">
                    <span className={`grid size-7 place-items-center border ${tone === "alert" ? "border-[#7c5cff]/30 bg-[#7c5cff]/[.09] text-[#b8a6ff]" : tone === "success" ? "border-[#6ee7c3]/20 bg-[#6ee7c3]/[.06] text-[#6ee7c3]" : "border-white/10 bg-white/[.03] text-[#9698ad]"}`}><Icon className="size-3.5" /></span>
                    <span className="text-[11px] text-[#c8c9d9]">{label}</span>
                    <span className="hidden font-mono text-[8px] text-[#686a82] sm:block">{meta}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-3 text-right font-mono text-[8px] uppercase text-[#62647c]">Illustrative workspace / source-backed review</p>
          </div>
        </div>

        <div className="flex h-14 items-center justify-between border-t border-white/[.09] text-[9px] uppercase text-[#686a82]">
          <span className="hidden sm:inline">Website monitoring / Evidence / Review history</span>
          <a href="#how-it-works" className="ml-auto inline-flex items-center gap-2 text-[#b2b3c8] transition-colors hover:text-white">Explore the system <ArrowDown className="size-3" /></a>
        </div>
      </div>
    </section>
  );
}
