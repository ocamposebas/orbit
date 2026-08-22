"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import { primaryNav } from "@/config/site";
import { Logo } from "@/components/ui/logo";
import { ButtonLink } from "@/components/ui/button-link";
import { cn } from "@/lib/utils";

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <header className="fixed inset-x-0 top-3 z-50 px-3 sm:top-4">
      <div className={cn("mx-auto flex h-[60px] max-w-[1180px] items-center justify-between rounded-[14px] border px-4 transition-all duration-300 sm:px-5", scrolled || open ? "border-white/[.11] bg-[#0c0e13]/92 shadow-[0_14px_50px_rgba(0,0,0,.38)] backdrop-blur-xl" : "border-white/[.08] bg-[#0a0c11]/62 backdrop-blur-md")}>
        <Logo />
        <nav aria-label="Primary navigation" className="hidden items-center gap-8 md:flex">
          {primaryNav.map((item) => <Link key={item.href} href={item.href} className="text-[12px] font-medium text-[#8d9099] transition-colors hover:text-white">{item.label}</Link>)}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <ButtonLink href="/login" variant="ghost">Sign in</ButtonLink>
          <ButtonLink href="/request-access">Request access</ButtonLink>
        </div>
        <button type="button" aria-expanded={open} aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen(!open)} className="grid size-9 place-items-center rounded-lg border border-white/10 bg-white/[.025] text-white md:hidden">
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "calc(100dvh - 82px)" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: .25 }} className="mx-auto mt-2 max-w-[1180px] overflow-hidden rounded-[14px] border border-white/[.09] bg-[#0a0c11]/98 shadow-2xl backdrop-blur-xl md:hidden">
            <nav aria-label="Mobile navigation" className="flex h-full flex-col px-5 py-5">
              {primaryNav.map((item, index) => (
                <motion.div key={item.href} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * .04 }}>
                  <Link href={item.href} onClick={() => setOpen(false)} className="block border-b border-white/[.07] py-5 text-2xl font-medium tracking-[-.03em]">{item.label}</Link>
                </motion.div>
              ))}
              <div className="mt-auto grid gap-3 pb-6">
                <ButtonLink href="/request-access" className="w-full">Request access</ButtonLink>
                <ButtonLink href="/login" variant="secondary" className="w-full">Sign in</ButtonLink>
              </div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
