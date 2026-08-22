"use client";

import { motion } from "framer-motion";
import { ButtonLink } from "@/components/ui/button-link";
import { HeroDashboard } from "@/components/dashboard-demo/hero-dashboard";
import { OrbitalBackdrop } from "@/components/ui/orbital-backdrop";

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden pb-24 pt-32 sm:pb-32 sm:pt-40">
      <OrbitalBackdrop />
      <div className="container-shell">
        <div className="mx-auto max-w-5xl text-center">
          <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .55 }} className="eyebrow justify-center">Continuous compliance intelligence</motion.p>
          <h1 className="mt-7 text-balance text-[clamp(3.45rem,9vw,8rem)] font-medium leading-[.84] tracking-[-.075em]">
            <span className="block overflow-hidden pb-2"><motion.span initial={{ y: "105%" }} animate={{ y: 0 }} transition={{ duration: .8, delay: .08, ease: [0.16, 1, 0.3, 1] }} className="block">Stay ahead</motion.span></span>
            <span className="block overflow-hidden pb-3"><motion.span initial={{ y: "105%" }} animate={{ y: 0 }} transition={{ duration: .8, delay: .16, ease: [0.16, 1, 0.3, 1] }} className="block text-[#9699a6]">of merchant risk.</motion.span></span>
          </h1>
          <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .65, delay: .28 }} className="mx-auto mt-7 max-w-3xl text-balance text-base leading-7 text-[#9b9ea6] sm:text-lg sm:leading-8">ORBIT continuously monitors merchant websites, compliance signals, policy coverage, and operational changes — helping teams identify risk before it becomes disruption.</motion.p>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .65, delay: .36 }} className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <ButtonLink href="/request-access">Request access</ButtonLink>
            <ButtonLink href="/product" variant="secondary">Explore the platform</ButtonLink>
          </motion.div>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .6, delay: .55 }} className="mt-6 text-xs text-[#656871]">Built for merchants, platforms, and risk teams.</motion.p>
        </div>
        <HeroDashboard />
      </div>
    </section>
  );
}
