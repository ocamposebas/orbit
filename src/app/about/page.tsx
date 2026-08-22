import type { Metadata } from "next";
import { Eye, History, Scale, ShieldCheck } from "lucide-react";
import { PageHero } from "@/components/marketing/page-hero";
import { FinalCta } from "@/components/marketing/home-sections";

export const metadata: Metadata = { title: "About", description: "ORBIT is an independent B2B software platform for merchant compliance monitoring and risk intelligence." };

const principles = [
  { title: "Current over static", text: "Risk posture should reflect what is live today, not only what was reviewed months ago.", icon: Eye },
  { title: "Evidence over opacity", text: "Every signal should point back to source content, a timestamp, and a clear review history.", icon: History },
  { title: "Support over determinations", text: "Software should help qualified teams make informed decisions, not present monitoring rules as legal conclusions.", icon: Scale },
  { title: "Clarity over claims", text: "ORBIT is independent B2B software — not a bank, acquirer, card network, legal advisor, or guarantee of processing approval.", icon: ShieldCheck },
];

export default function AboutPage() {
  return <>
    <PageHero eyebrow="Company" title="Make merchant risk easier to see." description="ORBIT is building the continuous intelligence layer between point-in-time merchant reviews and the websites, policies, products, and operational signals that keep changing." />
    <section className="py-24 sm:py-32"><div className="container-shell grid gap-14 lg:grid-cols-2"><div><p className="eyebrow">Our point of view</p><h2 className="mt-5 text-balance text-4xl font-medium leading-[1] tracking-[-.05em] sm:text-6xl">Compliance work deserves better context.</h2></div><div className="space-y-5 text-base leading-8 text-[#8c8f98]"><p>Merchant review is often fragmented across crawls, screenshots, spreadsheets, tickets, processor dashboards, and institutional memory. The evidence changes while the record stays still.</p><p>ORBIT brings monitoring, findings, remediation, and historical context into one workspace so teams can see what changed and document what happened next.</p><p>We focus on software and intelligence. Approval, underwriting, legal interpretation, and account decisions remain with the responsible institutions and teams.</p></div></div></section>
    <section className="border-y border-white/[.07] bg-[#0a0b0e] py-24 sm:py-32"><div className="container-shell"><p className="eyebrow">Product principles</p><div className="mt-10 grid border-l border-t border-white/[.08] sm:grid-cols-2">{principles.map(({title,text,icon:Icon}) => <div key={title} className="border-b border-r border-white/[.08] p-6 sm:p-8"><Icon className="size-5 text-[#9293ed]"/><h3 className="mt-10 text-lg font-medium tracking-[-.025em]">{title}</h3><p className="mt-3 max-w-sm text-sm leading-6 text-[#7d8089]">{text}</p></div>)}</div></div></section>
    <FinalCta/>
  </>;
}
