import type { Metadata } from "next";
import { Check } from "lucide-react";
import { RequestAccessForm } from "@/components/forms/request-access-form";

export const metadata: Metadata = { title: "Request Access", description: "Request access to ORBIT merchant compliance and risk intelligence software." };

export default function RequestAccessPage() {
  return <section className="page-orbit-hero relative overflow-hidden pb-24 pt-32 sm:pt-40"><div className="container-shell relative z-10 grid gap-14 lg:grid-cols-[.75fr_1.25fr]"><div><p className="eyebrow">Request access</p><h1 className="mt-6 text-balance text-5xl font-medium leading-[.92] sm:text-6xl lg:text-7xl">Bring changing risk into focus.</h1><p className="mt-6 max-w-md text-base leading-7 text-[#918d86]">Tell us what you need to monitor. This information helps us understand your workflow and product fit.</p><ul className="mt-10 space-y-4">{["Continuous website monitoring", "Structured findings and remediation", "Change history and audit evidence"].map(item => <li key={item} className="flex items-center gap-3 text-sm text-[#aaa69f]"><span className="grid size-5 place-items-center rounded-full border border-[#9ee6b3]/20 bg-[#9ee6b3]/[.06]"><Check className="size-3 text-[#9ee6b3]"/></span>{item}</li>)}</ul></div><RequestAccessForm/></div></section>;
}
