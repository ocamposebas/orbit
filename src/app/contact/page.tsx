import type { Metadata } from "next";
import { ContactForm } from "@/components/forms/contact-form";
import { PageHero } from "@/components/marketing/page-hero";

export const metadata: Metadata = { title: "Contact", description: "Contact ORBIT about merchant compliance monitoring, risk intelligence, and platform requirements." };

export default function ContactPage() {
  return <>
    <PageHero eyebrow="Contact" title="Talk to the team building ORBIT." description="Tell us about your merchants, monitoring workflow, or platform requirements. We will use the information to understand the fit." primary={false}/>
    <section className="py-20 sm:py-28"><div className="container-shell grid gap-12 lg:grid-cols-[.65fr_1.35fr]"><div><p className="text-sm leading-7 text-[#8c8f98]">Use this form for product, sales, partnership, and custom compliance website conversations.</p><div className="mt-10 border-t border-white/[.08] pt-6"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#696d76]">What happens next</p><ol className="mt-5 space-y-5"><li className="flex gap-4"><span className="font-mono text-[10px] text-[#8588ef]">01</span><p className="text-xs leading-6 text-[#aaadb4]">We review your merchant model, current website, and operating requirements.</p></li><li className="flex gap-4"><span className="font-mono text-[10px] text-[#8588ef]">02</span><p className="text-xs leading-6 text-[#aaadb4]">A specialist follows up with the right monitoring, compliance, or design path.</p></li><li className="flex gap-4"><span className="font-mono text-[10px] text-[#8588ef]">03</span><p className="text-xs leading-6 text-[#aaadb4]">Sensitive credentials and documents are never requested through this form.</p></li></ol></div></div><ContactForm/></div></section>
  </>;
}
