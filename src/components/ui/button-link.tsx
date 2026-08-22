import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function ButtonLink({ href, children, variant = "primary", className }: { href: string; children: React.ReactNode; variant?: "primary" | "secondary" | "ghost"; className?: string }) {
  return (
    <Link href={href} className={cn(
      "group inline-flex min-h-11 items-center justify-center gap-2 rounded-[9px] px-4 text-sm font-medium transition-all duration-200",
      variant === "primary" && "bg-[#f2f0eb] text-[#090a0c] shadow-[0_8px_32px_rgba(255,255,255,.08)] hover:bg-white hover:shadow-[0_10px_36px_rgba(255,255,255,.14)]",
      variant === "secondary" && "border border-white/12 bg-white/[.035] text-white hover:border-white/20 hover:bg-white/[.06]",
      variant === "ghost" && "text-[#b9bbc1] hover:text-white",
      className,
    )}>
      {children}
      {variant !== "ghost" && <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />}
    </Link>
  );
}
