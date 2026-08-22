"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { primaryNav } from "@/config/site";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 18);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <header className={cn(
      "fixed inset-x-0 top-0 z-50 border-b transition-[background-color,border-color] duration-300",
      scrolled || open ? "border-white/[.08] bg-[#08090b]/88 backdrop-blur-xl" : "border-transparent bg-transparent",
    )}>
      <div className="container-shell flex h-14 items-center justify-between">
        <Logo />

        <nav aria-label="Primary navigation" className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-7 md:flex">
          {primaryNav.map((item) => (
            <Link key={item.href} href={item.href} className="text-[12px] font-medium text-[#858892] transition-colors duration-200 hover:text-[#f2f0eb]">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-5 md:flex">
          <Link href="/login" className="text-[12px] font-medium text-[#92959e] transition-colors hover:text-white">Sign in</Link>
          <Link href="/request-access" className="group inline-flex h-9 items-center gap-2 rounded-lg bg-[#f2f0eb] px-3.5 text-[12px] font-medium text-[#090a0c] transition-colors hover:bg-white">
            Request access
            <ArrowUpRight aria-hidden="true" className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>

        <button type="button" aria-expanded={open} aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen(!open)} className="grid size-8 place-items-center rounded-md border border-white/10 bg-white/[.025] text-white md:hidden">
          {open ? <X className="size-4" /> : <Menu className="size-4" />}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "calc(100dvh - 56px)" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: .24, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden bg-[#08090b] md:hidden">
            <nav aria-label="Mobile navigation" className="container-shell flex h-full flex-col py-5">
              {primaryNav.map((item, index) => (
                <motion.div key={item.href} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .035 }}>
                  <Link href={item.href} onClick={() => setOpen(false)} className="flex items-center justify-between border-b border-white/[.07] py-4 text-xl font-medium tracking-[-.025em]">
                    {item.label}
                    <ArrowUpRight className="size-4 text-[#60636c]" />
                  </Link>
                </motion.div>
              ))}
              <div className="mt-auto grid gap-2 pb-3">
                <Link href="/request-access" onClick={() => setOpen(false)} className="flex h-11 items-center justify-center rounded-lg bg-[#f2f0eb] text-sm font-medium text-[#090a0c]">Request access</Link>
                <Link href="/login" onClick={() => setOpen(false)} className="flex h-11 items-center justify-center rounded-lg border border-white/10 text-sm font-medium text-[#b3b5bc]">Sign in</Link>
              </div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
