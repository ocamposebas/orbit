import type { Metadata } from "next";
import { BellRing, FileDiff, FileSearch, History, ScanLine, Workflow } from "lucide-react";
import { MonitoringScanner } from "@/components/dashboard-demo/monitoring-scanner";
import { FeatureList } from "@/components/marketing/feature-list";
import { FinalCta } from "@/components/marketing/home-sections";
import { PageHero } from "@/components/marketing/page-hero";
import { SectionHeading } from "@/components/ui/section-heading";

export const metadata: Metadata = { title: "Continuous Monitoring", description: "Continuously monitor merchant websites, policies, products, claims, and material changes with ORBIT." };

const features = [
  { title: "Scheduled scans", description: "Run recurring reviews of the merchant's public website surface without waiting for another point-in-time assessment.", icon: ScanLine },
  { title: "Page inventory", description: "Track discovered product, policy, checkout, and informational pages across each monitored domain.", icon: FileSearch },
  { title: "Change detection", description: "Compare the latest crawl with prior states to isolate added, removed, and modified content.", icon: FileDiff },
  { title: "Signal routing", description: "Apply industry-aware monitoring rules and route potential issues into a focused review workflow.", icon: Workflow },
  { title: "Review alerts", description: "Notify the right team when a change crosses configured severity or monitoring thresholds.", icon: BellRing },
  { title: "Historical evidence", description: "Keep scan timing, source paths, content states, and review actions attached to the record.", icon: History },
];

export default function MonitoringPage() {
  return <>
    <PageHero eyebrow="Continuous website monitoring" title="A current view, not a stale review." description="Merchant websites change after onboarding. ORBIT keeps watch across pages, products, policies, claims, and material content so teams can respond with context." />
    <section className="py-24 sm:py-32"><div className="container-shell"><SectionHeading eyebrow="How it works" title="Watch the surface. Preserve the evidence." description="A clean monitoring loop makes change visible without turning every edit into an emergency."/><div className="mt-12"><MonitoringScanner/></div></div></section>
    <section className="border-y border-white/[.07] bg-[#0a0b0e] py-24 sm:py-32"><div className="container-shell grid gap-14 lg:grid-cols-[.7fr_1.3fr]"><SectionHeading eyebrow="Monitoring workflow" title="Designed for continuous review." description="Configure the surface, collect changes, prioritize signals, and preserve the record."/><FeatureList items={features}/></div></section>
    <FinalCta/>
  </>;
}
