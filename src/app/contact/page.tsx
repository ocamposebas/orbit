import type { Metadata } from "next";
import { ContactForm } from "@/components/forms/contact-form";
import { PageHero } from "@/components/marketing/page-hero";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = { title: "Contact", description: "Contact ORBIT about merchant compliance monitoring, risk intelligence, and platform requirements." };

export default function ContactPage() {
  return <>
    <PageHero eyebrow="Contact" title="Talk to the team building ORBIT." description="Tell us about your merchants, monitoring workflow, or platform requirements. We will use the information to understand the fit." primary={false}/>
    <section className="py-20 sm:py-28"><div className="container-shell grid gap-12 lg:grid-cols-[.65fr_1.35fr]"><div><p className="text-sm leading-7 text-[#8c8f98]">Use this form for product, sales, and partnership conversations. ORBIT does not provide legal advice or payment-processing approval.</p><dl className="mt-10 space-y-5 border-t border-white/[.08] pt-6"><div><dt className="text-[10px] uppercase tracking-[.13em] text-[#5f626a]">Sales</dt><dd className="mt-1 font-mono text-xs text-[#aaaDB4]">{siteConfig.salesEmail}</dd></div><div><dt className="text-[10px] uppercase tracking-[.13em] text-[#5f626a]">Support</dt><dd className="mt-1 font-mono text-xs text-[#aaadb4]">{siteConfig.supportEmail}</dd></div><div><dt className="text-[10px] uppercase tracking-[.13em] text-[#5f626a]">Business address</dt><dd className="mt-1 text-xs text-[#aaadb4]">{siteConfig.address}</dd></div></dl><p className="mt-6 text-[10px] leading-5 text-[#5d6068]">Replace the centralized values in <span className="font-mono text-[#81848d]">src/config/site.ts</span> before production launch.</p></div><ContactForm/></div></section>
  </>;
}
