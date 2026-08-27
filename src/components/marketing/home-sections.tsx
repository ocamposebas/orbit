import { ArrowRight, Check, Database, FileClock, FileSearch, Globe2, KeyRound, Layers3, LayoutTemplate, LockKeyhole, ShieldCheck, SlidersHorizontal, Sparkles, Users } from "lucide-react";
import { MonitoringScanner } from "@/components/dashboard-demo/monitoring-scanner";
import { HealthDashboard } from "@/components/dashboard-demo/health-dashboard";
import { ChangeDiff } from "@/components/dashboard-demo/change-diff";
import { StatusPill } from "@/components/dashboard-demo/status-pill";
import { ButtonLink } from "@/components/ui/button-link";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { OrbitalBackdrop } from "@/components/ui/orbital-backdrop";

const timeline = [
  ["10:42 AM", "New product detected", "Catalog"],
  ["11:18 AM", "Policy modified", "Policy"],
  ["1:07 PM", "New marketing claim detected", "Content"],
  ["2:32 PM", "Finding resolved", "Remediation"],
] as const;

export function ProblemSection() {
  return (
    <section className="border-y border-white/[.07] py-24 sm:py-36">
      <div className="container-shell grid gap-16 lg:grid-cols-[.9fr_1.1fr] lg:items-center">
        <Reveal><SectionHeading eyebrow="The gap" title="Risk changes faster than quarterly reviews." description="Traditional compliance reviews capture only a moment in time. The merchant website keeps moving the moment the review ends." /></Reveal>
        <Reveal delay={.1}>
          <div className="relative pl-5 sm:pl-8">
            <div className="absolute bottom-4 left-[23px] top-4 w-px bg-gradient-to-b from-[#8b8cff]/50 via-white/10 to-transparent sm:left-[35px]"/>
            {timeline.map(([time, event, category], index) => (
              <div key={event} className="relative grid grid-cols-[20px_74px_1fr] items-center gap-3 border-b border-white/[.07] py-5 last:border-0 sm:grid-cols-[20px_92px_1fr] sm:gap-5">
                <span className={`relative z-10 size-2.5 rounded-full border-2 border-[#111318] ${index === 2 ? "bg-[#e7bd72] shadow-[0_0_12px_rgba(231,189,114,.5)]" : "bg-[#8b8cff]"}`} />
                <span className="font-mono text-[9px] text-[#60636c] sm:text-[10px]">{time}</span>
                <div className="flex min-w-0 items-center justify-between gap-3"><span className="text-xs text-[#c0c2c7] sm:text-sm">{event}</span><span className="hidden text-[9px] uppercase tracking-[.1em] text-[#555860] sm:block">{category}</span></div>
              </div>
            ))}
          </div>
          <p className="mt-6 max-w-xl text-sm leading-7 text-[#858891]">Products are added. Policies are edited. Claims appear. Checkout flows change. Campaigns launch. ORBIT monitors what changes between reviews.</p>
        </Reveal>
      </div>
    </section>
  );
}

export function MonitoringSection() {
  return (
    <section id="monitoring" className="py-24 sm:py-36">
      <div className="container-shell">
        <Reveal><SectionHeading eyebrow="Continuous monitoring" title="Your website never stops changing. Neither should your monitoring." description="Scheduled scans inventory the surface of a merchant website, compare states, and route meaningful changes into a focused review queue." /></Reveal>
        <Reveal delay={.12} className="mt-12 sm:mt-16"><MonitoringScanner /></Reveal>
      </div>
    </section>
  );
}

const findings = [
  { type: "Medical claim", level: "High", tone: "warning" as const, path: "/products/research-alpha", quote: "“Supports rapid weight loss…”", recommendation: "Consumer-directed efficacy language may conflict with the merchant’s declared business model.", time: "2 minutes ago" },
  { type: "Policy coverage", level: "Medium", tone: "accent" as const, path: "/policies/refunds", quote: "Refund policy does not clearly define cancellation conditions.", recommendation: "Review cancellation timing and eligibility language for completeness.", time: "18 minutes ago" },
  { type: "Website change", level: "Low", tone: "neutral" as const, path: "/products/new", quote: "New product page detected.", recommendation: "Classify the product and confirm it aligns with the current merchant profile.", time: "41 minutes ago" },
];

export function FindingsSection() {
  return (
    <section id="findings" className="border-y border-white/[.07] bg-[#0a0b0e] py-24 sm:py-36">
      <div className="container-shell">
        <Reveal><SectionHeading eyebrow="Compliance findings" title="Find the signal inside the noise." description="A structured review queue turns raw site changes into prioritized, explainable findings with evidence and recommended next steps." /></Reveal>
        <div className="mt-12 overflow-hidden rounded-2xl border border-white/[.08] bg-[#0d0f12] sm:mt-16">
          <div className="hidden grid-cols-[1fr_90px_160px] border-b border-white/[.07] px-5 py-3 text-[9px] uppercase tracking-[.12em] text-[#5c5f67] md:grid"><span>Finding</span><span>Severity</span><span>Detected</span></div>
          {findings.map((finding, index) => (
            <Reveal key={finding.type} delay={index * .07}>
              <article className="grid gap-5 border-b border-white/[.07] p-5 last:border-0 md:grid-cols-[1fr_90px_160px] md:gap-0">
                <div className="pr-6"><div className="flex items-center gap-2"><FileSearch className="size-3.5 text-[#777a83]"/><span className="text-[10px] font-semibold uppercase tracking-[.12em] text-[#b6b8be]">{finding.type}</span></div><p className="mt-3 font-mono text-[10px] text-[#666a73]">{finding.path}</p><p className="mt-3 text-sm text-[#d1cfc9]">{finding.quote}</p><p className="mt-3 max-w-xl text-[11px] leading-5 text-[#757881]"><span className="text-[#9b9ea6]">Recommendation:</span> {finding.recommendation}</p></div>
                <div className="flex items-start md:block"><StatusPill tone={finding.tone}>{finding.level}</StatusPill></div>
                <div className="flex items-center justify-between text-[10px] text-[#656871] md:block"><span className="md:hidden">Detected</span><span>{finding.time}</span></div>
              </article>
            </Reveal>
          ))}
        </div>
        <p className="mt-4 text-[10px] text-[#565960]">Illustrative findings. ORBIT supports human review and does not make legal determinations.</p>
      </div>
    </section>
  );
}

export function MerchantHealthSection() {
  return (
    <section className="py-24 sm:py-36">
      <div className="container-shell">
        <Reveal><SectionHeading eyebrow="Merchant health" title="One view of merchant health." description="Bring website compliance, policy coverage, verification, findings, and review activity together in one focused workspace." /></Reveal>
        <Reveal delay={.12} className="mt-12 sm:mt-16"><HealthDashboard /></Reveal>
      </div>
    </section>
  );
}

export function CustomComplianceSection() {
  const deliverables = ["Merchant-ready storefront design", "Policy and disclosure architecture", "Age and research-use controls", "Checkout UX and evidence capture"];
  return <section className="relative overflow-hidden border-y border-[#d6d0c3] bg-[#ece8de] py-24 text-[#171713] sm:py-32"><div className="absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_80%_10%,rgba(92,88,180,.2),transparent_28%),linear-gradient(rgba(20,20,16,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(20,20,16,.05)_1px,transparent_1px)] [background-size:auto,56px_56px,56px_56px]"/><div className="container-shell relative"><div className="grid gap-14 lg:grid-cols-[.8fr_1.2fr] lg:items-end"><Reveal><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[#62605a]">Custom compliance web design</p><h2 className="mt-6 max-w-xl text-balance text-4xl font-medium leading-[.96] tracking-[-.055em] sm:text-6xl">A serious storefront, designed around the controls your business needs.</h2></Reveal><Reveal delay={.08}><p className="max-w-xl text-base leading-8 text-[#595750]">ORBIT combines custom web design with merchant-risk structure: clear product positioning, disciplined claims, usable policies, age or intended-use gates, and checkout disclosures that are built into the customer journey.</p><ButtonLink href="/custom-compliance" className="mt-7 bg-[#171713] text-white hover:bg-black">Explore custom web design</ButtonLink></Reveal></div><div className="mt-16 grid overflow-hidden rounded-[28px] border border-black/10 bg-[#f7f4ec] shadow-[0_30px_100px_rgba(42,38,26,.14)] lg:grid-cols-[1.15fr_.85fr]"><div className="p-7 sm:p-10"><div className="flex items-center justify-between"><span className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-[#6b6961]"><LayoutTemplate className="size-4"/> Design system</span><Sparkles className="size-4 text-[#7770c8]"/></div><div className="mt-20 max-w-lg"><p className="text-sm text-[#727068]">Built for credibility</p><h3 className="mt-3 text-3xl font-medium tracking-[-.045em] sm:text-5xl">Beautiful enough for customers. Structured enough for risk review.</h3></div></div><div className="border-t border-black/10 bg-[#1a1a17] p-7 text-white lg:border-l lg:border-t-0 sm:p-10"><p className="text-[10px] uppercase tracking-[.16em] text-white/45">Included foundation</p><ul className="mt-10 space-y-5">{deliverables.map((item,index)=><li key={item} className="flex items-center gap-4 border-b border-white/10 pb-5"><span className="font-mono text-[9px] text-[#9994e8]">0{index+1}</span><span className="text-sm text-white/80">{item}</span><Check className="ml-auto size-4 text-[#8ed7b5]"/></li>)}</ul></div></div></div></section>;
}

export function ChangesSection() {
  return (
    <section id="changes" className="border-y border-white/[.07] bg-[#0a0b0e] py-24 sm:py-36">
      <div className="container-shell">
        <Reveal><SectionHeading eyebrow="Change intelligence" title="Know exactly what changed." description="Preserve the previous state, isolate the new language, and understand why a change deserves attention — with the evidence attached." /></Reveal>
        <Reveal delay={.12} className="mt-12 sm:mt-16"><ChangeDiff /></Reveal>
      </div>
    </section>
  );
}

const auditSteps = ["Finding detected", "Finding acknowledged", "Website updated", "Rescan completed", "Finding resolved", "Reviewer approved"];

export function AuditSection() {
  return (
    <section id="audit-trail" className="py-24 sm:py-36">
      <div className="container-shell grid gap-14 lg:grid-cols-[.8fr_1.2fr] lg:items-center">
        <Reveal><SectionHeading eyebrow="Audit trail" title="Every decision has a history." description="ORBIT keeps findings, evidence, assignments, remediation, rescans, and review outcomes connected — ready for internal oversight and structured reviews." /></Reveal>
        <Reveal delay={.1}>
          <div className="panel rounded-2xl p-5 sm:p-7">
            <div className="flex items-center justify-between border-b border-white/[.07] pb-4"><div className="flex items-center gap-2"><FileClock className="size-4 text-[#a9aaff]"/><span className="text-xs font-medium">Finding history</span></div><StatusPill tone="success">Resolved</StatusPill></div>
            <div className="relative mt-3">
              <div className="absolute bottom-5 left-[7px] top-5 w-px bg-white/[.09]"/>
              {auditSteps.map((step, index) => <div key={step} className="relative flex items-center gap-4 py-3.5"><span className={`relative z-10 grid size-[15px] place-items-center rounded-full ${index === auditSteps.length - 1 ? "bg-[#78d6ad] text-[#0b1611]" : "border border-[#8b8cff]/45 bg-[#111319]"}`}>{index === auditSteps.length - 1 && <Check className="size-2.5"/>}</span><span className="flex-1 text-xs text-[#aeb0b7]">{step}</span><span className="font-mono text-[9px] text-[#575a62]">{index < 2 ? "Aug 18" : index < 5 ? "Aug 19" : "Aug 20"}</span></div>)}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const industries = ["Research Products", "Supplements", "Cosmetics", "High-Risk Ecommerce", "Subscription Commerce", "Digital Services"];

export function RulesetsSection() {
  return (
    <section className="border-y border-white/[.07] bg-[#0a0b0e] py-24 sm:py-36">
      <div className="container-shell">
        <Reveal><SectionHeading eyebrow="Industry rulesets" title="Different industries. Different risks." description="Industry-aware monitoring rules adapt what ORBIT looks for while keeping review decisions in the hands of your team." /></Reveal>
        <div className="mt-12 grid border-l border-t border-white/[.08] sm:grid-cols-2 lg:grid-cols-3">
          {industries.map((industry, index) => <Reveal key={industry} delay={index*.04}><div className="group flex min-h-28 items-end justify-between border-b border-r border-white/[.08] p-5 transition-colors hover:bg-white/[.025]"><div><span className="font-mono text-[9px] text-[#565961]">0{index+1}</span><h3 className="mt-5 text-sm font-medium text-[#bebfc4]">{industry}</h3></div><ArrowRight className="size-4 text-[#51545c] transition-transform group-hover:translate-x-1 group-hover:text-[#a9aaff]"/></div></Reveal>)}
        </div>
        <p className="mt-4 text-[10px] text-[#5d6068]">Rules identify signals for review; they do not constitute legal advice or automated legal determinations.</p>
      </div>
    </section>
  );
}

const audiences = [
  { label: "Merchants", text: "Understand your compliance posture before problems escalate.", icon: Globe2 },
  { label: "Platforms", text: "Monitor merchant portfolios continuously.", icon: Layers3 },
  { label: "Risk teams", text: "Centralize findings, remediation, and audit history.", icon: Users },
];

export function BuiltForSection() {
  return (
    <section className="border-y border-white/[.07] bg-[#0a0b0e] py-24 sm:py-32">
      <div className="container-shell">
        <Reveal><SectionHeading eyebrow="Built for" title="A clearer operating layer for merchant risk." /></Reveal>
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-white/[.08] bg-white/[.07] lg:grid-cols-3">
          {audiences.map(({label,text,icon:Icon}, index) => <Reveal key={label} delay={index*.07}><div className="h-full bg-[#0d0f12] p-6 sm:p-8"><Icon className="size-5 text-[#9293ed]"/><p className="mt-14 text-[10px] font-semibold uppercase tracking-[.15em] text-[#777a83]">{label}</p><p className="mt-3 max-w-xs text-lg leading-7 tracking-[-.025em] text-[#d7d5d0]">{text}</p></div></Reveal>)}
        </div>
      </div>
    </section>
  );
}

const security = [
  { label: "Encryption in transit", icon: LockKeyhole }, { label: "Role-based access architecture", icon: KeyRound },
  { label: "Audit logging", icon: FileClock }, { label: "Minimal sensitive-data collection", icon: Database },
  { label: "Workspace access controls", icon: ShieldCheck }, { label: "Configurable review permissions", icon: SlidersHorizontal },
];

export function SecuritySection() {
  return (
    <section className="py-24 sm:py-36">
      <div className="container-shell grid gap-14 lg:grid-cols-[.8fr_1.2fr]">
        <Reveal><SectionHeading eyebrow="Security & trust" title="Built for sensitive operations." description="ORBIT is designed around controlled access, verifiable events, and reduced data exposure — without claiming certifications the platform has not earned." /></Reveal>
        <Reveal delay={.1}><div className="border-t border-white/[.08]">{security.map(({label,icon:Icon}) => <div key={label} className="flex items-center gap-3 border-b border-white/[.08] py-4"><Icon className="size-4 text-[#7f81d6]"/><span className="text-sm text-[#aeb0b7]">{label}</span><Check className="ml-auto size-3.5 text-[#5e967e]"/></div>)}</div></Reveal>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="relative isolate overflow-hidden border-t border-white/[.07] py-24 sm:py-36">
      <OrbitalBackdrop compact />
      <div className="container-shell text-center">
        <Reveal><p className="eyebrow justify-center">Take the next step</p><h2 className="mx-auto mt-6 max-w-4xl text-balance text-[clamp(2.8rem,7vw,6rem)] font-medium leading-[.92] tracking-[-.065em]">See risk before it becomes disruption.</h2><p className="mx-auto mt-6 max-w-xl text-balance text-base leading-7 text-[#8f929b]">Build a clearer, continuously monitored view of merchant compliance.</p><div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row"><ButtonLink href="/request-access">Request access</ButtonLink><ButtonLink href="/contact" variant="secondary">Contact sales</ButtonLink></div></Reveal>
      </div>
    </section>
  );
}
