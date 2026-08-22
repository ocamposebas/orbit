import type { Metadata } from "next";
import { Check } from "lucide-react";
import { RequestAccessForm } from "@/components/forms/request-access-form";
import { OrbitalBackdrop } from "@/components/ui/orbital-backdrop";

export const metadata: Metadata = { title: "Request Access", description: "Request access to ORBIT merchant compliance and risk intelligence software." };

export default function RequestAccessPage() {
  return <section className="relative overflow-hidden pb-24 pt-32 sm:pt-40"><OrbitalBackdrop compact/><div className="container-shell grid gap-14 lg:grid-cols-[.75fr_1.25fr]"><div><p className="eyebrow">Request access</p><h1 className="mt-6 text-balance text-[clamp(3rem,7vw,6rem)] font-medium leading-[.92] tracking-[-.065em]">Bring changing risk into focus.</h1><p className="mt-6 max-w-md text-base leading-7 text-[#93969f]">Tell us what you need to monitor. This information helps us understand your workflow and product fit.</p><ul className="mt-10 space-y-4">{["Continuous website monitoring", "Structured findings and remediation", "Change history and audit evidence"].map(item => <li key={item} className="flex items-center gap-3 text-sm text-[#a5a7ae]"><span className="grid size-5 place-items-center rounded-full border border-[#78d6ad]/20 bg-[#78d6ad]/[.06]"><Check className="size-3 text-[#78d6ad]"/></span>{item}</li>)}</ul></div><RequestAccessForm/></div></section>;
}
