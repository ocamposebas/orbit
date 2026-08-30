import { cn } from "@/lib/utils";

const tones = {
  success: "border-[#78d6ad]/20 bg-[#78d6ad]/[.08] text-[#91e0bd]",
  warning: "border-[#e7bd72]/20 bg-[#e7bd72]/[.08] text-[#e7c98d]",
  danger: "border-[#e68181]/20 bg-[#e68181]/[.08] text-[#eca0a0]",
  neutral: "border-white/10 bg-white/[.04] text-[#aeb1b8]",
  accent: "border-[#ff6547]/25 bg-[#ff6547]/10 text-[#ff9a85]",
};

export function StatusPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: keyof typeof tones }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium", tones[tone])}>{children}</span>;
}
