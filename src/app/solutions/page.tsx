import type { Metadata } from "next";
import { ArrowRight, Building2, Store, Users } from "lucide-react";
import { PageHero } from "@/components/marketing/page-hero";
import { FinalCta } from "@/components/marketing/home-sections";

export const metadata: Metadata = { title: "Solutions", description: "Merchant compliance and risk intelligence solutions for merchants, platforms, and risk teams." };

const profiles = [
  { label: "Merchants", title: "Prepare before issues escalate.", description: "Understand website compliance posture, policy coverage, open findings, and significant changes before the next internal or external review.", bullets: ["Website and policy monitoring", "Remediation workflow", "Audit-ready history"], icon: Store },
  { label: "Platforms", title: "Monitor merchant portfolios continuously.", description: "Create a consistent oversight layer across a merchant portfolio while keeping each merchant's evidence, findings, and review history separate.", bullets: ["Portfolio monitoring", "Change visibility", "Merchant-level evidence"], icon: Building2 },
  { label: "Risk teams", title: "Replace fragmented review queues.", description: "Centralize findings, ownership, remediation, rescans, and historical decisions in an operating view built for ongoing work.", bullets: ["Prioritized findings", "Review assignments", "Decision history"], icon: Users },
];

export default function SolutionsPage() {
  return <>
    <PageHero eyebrow="Solutions" title="A shared view of changing merchant risk." description="ORBIT helps merchants, platforms, and risk teams work from the same evidence without blurring who makes the final decision." />
    <section className="py-24 sm:py-32"><div className="container-shell space-y-4">{profiles.map(({label,title,description,bullets,icon:Icon},index) => <article key={label} className="group grid gap-8 rounded-2xl border border-white/[.08] bg-[#0d0f12] p-6 transition-colors hover:border-white/[.14] sm:p-9 lg:grid-cols-[.8fr_1.2fr]"><div><span className="font-mono text-[9px] text-[#575a62]">0{index+1}</span><Icon className="mt-10 size-5 text-[#9293ed]"/><p className="mt-4 text-[10px] font-semibold uppercase tracking-[.15em] text-[#787b84]">{label}</p></div><div><h2 className="text-balance text-3xl font-medium tracking-[-.045em] sm:text-4xl">{title}</h2><p className="mt-5 max-w-xl text-sm leading-7 text-[#888b94]">{description}</p><ul className="mt-7 grid gap-3 sm:grid-cols-3">{bullets.map(item => <li key={item} className="flex items-center gap-2 text-[11px] text-[#a4a6ad]"><ArrowRight className="size-3 text-[#7779c9]"/>{item}</li>)}</ul></div></article>)}</div></section>
    <FinalCta/>
  </>;
}
