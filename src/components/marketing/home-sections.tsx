import {
  ArrowRight,
  CircleCheck,
  FileClock,
  FileSearch,
  Globe2,
  Layers3,
  ShieldCheck,
  Store,
  Users,
} from "lucide-react";
import { ChangeDiff } from "@/components/dashboard-demo/change-diff";
import { HealthDashboard } from "@/components/dashboard-demo/health-dashboard";
import { MonitoringScanner } from "@/components/dashboard-demo/monitoring-scanner";
import { ButtonLink } from "@/components/ui/button-link";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";

const system = [
  {
    number: "01",
    title: "Observe the live surface",
    text: "ORBIT inventories products, policies, claims, checkout language, and the pages that define a merchant's public risk posture.",
    icon: Globe2,
  },
  {
    number: "02",
    title: "Isolate what matters",
    text: "Material changes become prioritized findings with the original source, surrounding context, and a clear reason to review.",
    icon: FileSearch,
  },
  {
    number: "03",
    title: "Preserve the decision",
    text: "Acknowledgement, remediation, rescans, and approval remain connected in one traceable operating record.",
    icon: FileClock,
  },
] as const;

export function SystemSection() {
  return (
    <section id="how-it-works" className="border-b border-white/[.09] bg-[#060606] py-24 sm:py-32">
      <div className="container-shell">
        <Reveal>
          <div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr] lg:items-end">
            <SectionHeading
              eyebrow="The operating system"
              title="From a changing website to reviewable evidence."
            />
            <p className="max-w-xl text-base leading-8 text-[#918d86] lg:justify-self-end">
              A merchant review should not expire the moment a site changes. ORBIT keeps the public surface, the detected signal, and your team&apos;s response in the same line of sight.
            </p>
          </div>
        </Reveal>

        <div className="mt-16 border-t border-white/[.1]">
          {system.map(({ number, title, text, icon: Icon }, index) => (
            <Reveal key={number} delay={index * 0.06}>
              <article className="group grid gap-5 border-b border-white/[.1] py-7 sm:grid-cols-[72px_1fr_1.2fr_32px] sm:items-center sm:gap-7">
                <span className="font-mono text-[10px] text-[#ff7458]">{number}</span>
                <div className="flex items-center gap-3">
                  <Icon className="size-4 text-[#a6a29b]" />
                  <h3 className="text-base font-medium text-[#e9e6df]">{title}</h3>
                </div>
                <p className="max-w-xl text-sm leading-6 text-[#7e7b75]">{text}</p>
                <ArrowRight className="hidden size-4 text-[#4f4d49] transition-transform group-hover:translate-x-1 group-hover:text-[#ff7458] sm:block" />
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function MonitoringSection() {
  return (
    <section id="monitoring" className="relative overflow-hidden border-b border-white/[.09] bg-[#0a0a0a] py-24 sm:py-32">
      <div className="absolute inset-y-0 left-1/2 w-px bg-white/[.04]" aria-hidden="true" />
      <div className="container-shell relative">
        <div className="grid gap-12 lg:grid-cols-[.68fr_1.32fr] lg:items-start">
          <Reveal>
            <div className="lg:sticky lg:top-28">
              <SectionHeading
                eyebrow="Continuous monitoring"
                title="A live map of the merchant surface."
                description="Scheduled investigations show what exists now, what appeared since the last review, and where your attention is required."
              />
              <div className="mt-9 border-l border-[#ff6547]/60 pl-5">
                <p className="font-mono text-[10px] uppercase text-[#77736d]">What ORBIT watches</p>
                <p className="mt-3 max-w-sm text-sm leading-7 text-[#a09c95]">Products, policies, consumer claims, intended-use language, checkout disclosures, and meaningful content changes.</p>
              </div>
            </div>
          </Reveal>
          <Reveal delay={0.1}><MonitoringScanner /></Reveal>
        </div>
      </div>
    </section>
  );
}

const findings = [
  {
    status: "High",
    type: "Consumer claim",
    path: "/products/research-alpha",
    quote: '"Supports rapid weight loss..."',
    action: "Review against the merchant's declared business model.",
  },
  {
    status: "Medium",
    type: "Policy coverage",
    path: "/policies/refunds",
    quote: "Cancellation conditions are not clearly defined.",
    action: "Confirm timing, eligibility, and refund language.",
  },
  {
    status: "New",
    type: "Catalog change",
    path: "/products/new",
    quote: "A new product page was published.",
    action: "Classify the product and verify profile alignment.",
  },
] as const;

export function FindingsSection() {
  return (
    <section id="findings" className="border-b border-white/[.09] bg-[#060606] py-24 sm:py-32">
      <div className="container-shell">
        <Reveal>
          <div className="grid gap-10 lg:grid-cols-[.75fr_1.25fr] lg:items-end">
            <SectionHeading eyebrow="Focused review" title="Not more alerts. Better decisions." />
            <p className="max-w-2xl text-base leading-8 text-[#918d86] lg:justify-self-end">
              Every finding answers four questions: what changed, where it lives, why it deserves review, and what the team should do next.
            </p>
          </div>
        </Reveal>

        <div className="mt-16 border-t border-white/[.1]">
          {findings.map((finding, index) => (
            <Reveal key={finding.path} delay={index * 0.06}>
              <article className="grid gap-5 border-b border-white/[.1] py-7 md:grid-cols-[90px_1fr_1.15fr] md:gap-8">
                <div>
                  <span className={`inline-flex items-center gap-2 font-mono text-[9px] uppercase ${index === 0 ? "text-[#ff8068]" : index === 1 ? "text-[#f0c36b]" : "text-[#9bbfd0]"}`}>
                    <span className="size-1.5 rounded-full bg-current" /> {finding.status}
                  </span>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase text-[#77736d]">{finding.type}</p>
                  <p className="mt-2 font-mono text-[9px] text-[#5e5b56]">{finding.path}</p>
                  <p className="mt-4 text-base text-[#d7d3cc]">{finding.quote}</p>
                </div>
                <div className="md:border-l md:border-white/[.08] md:pl-8">
                  <p className="text-[10px] uppercase text-[#66635d]">Recommended review</p>
                  <p className="mt-3 max-w-lg text-sm leading-6 text-[#9a968f]">{finding.action}</p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
        <p className="mt-5 max-w-2xl text-[10px] leading-5 text-[#5e5b56]">Illustrative findings. ORBIT supports qualified human review and does not make legal determinations.</p>
      </div>
    </section>
  );
}

export function EvidenceSection() {
  return (
    <section id="changes" className="border-b border-white/[.09] bg-[#0a0a0a] py-24 sm:py-32">
      <div className="container-shell">
        <Reveal>
          <div className="grid gap-10 lg:grid-cols-[.9fr_1.1fr] lg:items-end">
            <SectionHeading eyebrow="Change intelligence" title="The evidence stays attached." />
            <p className="max-w-xl text-base leading-8 text-[#918d86] lg:justify-self-end">Compare saved states, isolate the new language, and see the reason a change entered the review queue.</p>
          </div>
        </Reveal>
        <Reveal delay={0.1} className="mt-14"><ChangeDiff /></Reveal>
      </div>
    </section>
  );
}

export function MerchantHealthSection() {
  return (
    <section className="border-b border-white/[.09] bg-[#060606] py-24 sm:py-32">
      <div className="container-shell">
        <div className="grid gap-12 lg:grid-cols-[.7fr_1.3fr] lg:items-center">
          <Reveal>
            <SectionHeading
              eyebrow="One operating view"
              title="Know the state of every merchant."
              description="Monitoring status, policy coverage, findings, and review activity stay together so posture is current and explainable."
            />
          </Reveal>
          <Reveal delay={0.1}><HealthDashboard /></Reveal>
        </div>
      </div>
    </section>
  );
}

const audiences = [
  { label: "Merchants", title: "Fix issues before they escalate.", text: "Understand the live compliance posture of your own storefront.", icon: Store },
  { label: "Platforms", title: "See across the portfolio.", text: "Apply consistent oversight while preserving merchant-level evidence.", icon: Layers3 },
  { label: "Risk teams", title: "Replace fragmented review queues.", text: "Keep findings, owners, remediation, and decisions in one place.", icon: Users },
] as const;

export function BuiltForSection() {
  return (
    <section className="border-b border-white/[.09] bg-[#0a0a0a] py-24 sm:py-32">
      <div className="container-shell">
        <Reveal><SectionHeading eyebrow="Built for modern commerce" title="One system. Three lines of sight." /></Reveal>
        <div className="mt-14 grid border-l border-t border-white/[.1] md:grid-cols-3">
          {audiences.map(({ label, title, text, icon: Icon }, index) => (
            <Reveal key={label} delay={index * 0.06}>
              <article className="group flex min-h-[280px] h-full flex-col border-b border-r border-white/[.1] p-6 transition-colors hover:bg-white/[.02] sm:p-8">
                <div className="flex items-center justify-between">
                  <Icon className="size-5 text-[#ff7458]" />
                  <span className="font-mono text-[9px] text-[#55524e]">0{index + 1}</span>
                </div>
                <div className="mt-auto pt-16">
                  <p className="text-[10px] font-medium uppercase text-[#77736d]">{label}</p>
                  <h3 className="mt-3 text-xl font-medium leading-7 text-[#e6e2db]">{title}</h3>
                  <p className="mt-3 max-w-xs text-sm leading-6 text-[#7e7b75]">{text}</p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CustomComplianceSection() {
  return (
    <section className="border-b border-white/[.09] bg-[#060606]">
      <div className="container-shell grid gap-8 py-16 lg:grid-cols-[1.2fr_.8fr] lg:items-center">
        <Reveal>
          <p className="text-[10px] font-medium uppercase text-[#ff7458]">Beyond detection</p>
          <h2 className="mt-4 max-w-3xl text-3xl font-medium leading-tight text-[#e9e6df] sm:text-4xl">When the storefront is the risk, we can rebuild the surface too.</h2>
        </Reveal>
        <Reveal delay={0.08}>
          <p className="max-w-xl text-sm leading-7 text-[#89857f]">Custom commerce experiences with clear policies, appropriate controls, and compliance-aware language built into the launch.</p>
          <ButtonLink href="/custom-compliance" variant="secondary" className="mt-6">Explore web design</ButtonLink>
        </Reveal>
      </div>
    </section>
  );
}

export function SecuritySection() {
  const items = ["Controlled workspace access", "Evidence timestamps", "Review audit history", "Minimal sensitive data"];
  return (
    <section className="border-b border-white/[.09] bg-[#0a0a0a] py-16">
      <div className="container-shell grid gap-8 lg:grid-cols-[.65fr_1.35fr] lg:items-center">
        <Reveal>
          <div className="flex items-center gap-3"><ShieldCheck className="size-5 text-[#9ee6b3]" /><p className="text-sm font-medium text-[#d7d3cc]">Built for sensitive operations</p></div>
        </Reveal>
        <Reveal delay={0.08}>
          <div className="grid gap-px bg-white/[.09] sm:grid-cols-2">
            {items.map((item) => <div key={item} className="flex items-center gap-3 bg-[#0a0a0a] px-5 py-4 text-xs text-[#96928b]"><CircleCheck className="size-3.5 text-[#9ee6b3]" />{item}</div>)}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="final-orbit relative isolate overflow-hidden bg-[#060606] py-24 sm:py-36">
      <div className="container-shell relative z-10">
        <Reveal>
          <div className="max-w-5xl">
            <p className="text-[10px] font-medium uppercase text-[#ff7458]">Keep risk in view</p>
            <h2 className="mt-6 text-5xl font-medium leading-[.9] text-[#f3f0e9] sm:text-7xl lg:text-8xl">Stay ahead of what changes.</h2>
            <p className="mt-7 max-w-xl text-base leading-7 text-[#918d86]">Build a continuously monitored, evidence-backed view of merchant compliance.</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row"><ButtonLink href="/request-access">Request access</ButtonLink><ButtonLink href="/contact" variant="secondary">Talk to us</ButtonLink></div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
