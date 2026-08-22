import type { Metadata } from "next";
import { ClipboardCheck, FileClock, FileSearch, Gauge, GitCompareArrows, ScanSearch } from "lucide-react";
import { ChangeDiff } from "@/components/dashboard-demo/change-diff";
import { HealthDashboard } from "@/components/dashboard-demo/health-dashboard";
import { FeatureList } from "@/components/marketing/feature-list";
import { FinalCta } from "@/components/marketing/home-sections";
import { PageHero } from "@/components/marketing/page-hero";
import { SectionHeading } from "@/components/ui/section-heading";

export const metadata: Metadata = { title: "Product", description: "Explore ORBIT's merchant compliance monitoring, findings, change intelligence, health signals, and audit trails." };

const features = [
  { title: "Continuous monitoring", description: "Scan merchant websites on a schedule and maintain a current inventory of pages, products, policies, and relevant changes.", icon: ScanSearch },
  { title: "Structured findings", description: "Turn detected signals into severity-ranked issues with source evidence, context, ownership, and remediation status.", icon: FileSearch },
  { title: "Change intelligence", description: "Compare content states line by line so reviewers can understand exactly what appeared, disappeared, or changed.", icon: GitCompareArrows },
  { title: "Merchant health", description: "Unify compliance posture, monitoring status, policy coverage, findings, and review activity in one internal ORBIT view.", icon: Gauge },
  { title: "Audit history", description: "Retain the events behind each finding, from detection and acknowledgement through rescan and resolution.", icon: FileClock },
  { title: "Remediation workflow", description: "Assign findings, document website updates, run rescans, and keep resolution evidence attached to the record.", icon: ClipboardCheck },
];

export default function ProductPage() {
  return <>
    <PageHero eyebrow="The platform" title="Compliance intelligence that stays current." description="ORBIT gives risk teams a continuously updated operating view of merchant websites, material changes, findings, remediation, and evidence." />
    <section className="py-24 sm:py-32"><div className="container-shell grid gap-14 lg:grid-cols-[.65fr_1.35fr]"><SectionHeading eyebrow="System of record" title="From change to decision." description="A clear workflow for monitoring what changed, deciding what matters, and preserving what happened next."/><FeatureList items={features}/></div></section>
    <section id="changes" className="border-y border-white/[.07] bg-[#0a0b0e] py-24 sm:py-32"><div className="container-shell"><SectionHeading eyebrow="Evidence-first" title="See the content behind the signal." description="Compare saved states and keep the source context attached to every review."/><div className="mt-12"><ChangeDiff/></div></div></section>
    <section id="findings" className="py-24 sm:py-32"><div className="container-shell"><SectionHeading eyebrow="Unified posture" title="A practical view of merchant health." description="The ORBIT Health Score is an internal monitoring indicator built from website, policy, finding, and review signals."/><div className="mt-12"><HealthDashboard/></div></div></section>
    <div id="audit-trail"><FinalCta/></div>
  </>;
}
