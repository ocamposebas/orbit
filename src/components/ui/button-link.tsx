import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function ButtonLink({ href, children, variant = "primary", className }: { href: string; children: React.ReactNode; variant?: "primary" | "secondary" | "ghost"; className?: string }) {
  return (
    <Link href={href} className={cn(
      "group inline-flex min-h-11 items-center justify-center gap-2 rounded-[6px] px-4 text-sm font-medium transition-all duration-200",
      variant === "primary" && "border border-[#ff6547]/55 bg-[#ff6547] text-[#140806] shadow-[0_10px_36px_rgba(255,101,71,.12)] hover:bg-[#ff8068] hover:shadow-[0_12px_44px_rgba(255,101,71,.18)]",
      variant === "secondary" && "border border-white/14 bg-black/20 text-white backdrop-blur-sm hover:border-white/25 hover:bg-white/[.06]",
      variant === "ghost" && "text-[#b9bbc1] hover:text-white",
      className,
    )}>
      {children}
      {variant !== "ghost" && <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />}
    </Link>
  );
}
