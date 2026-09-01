import { cn } from "@/lib/utils";

export function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const tone = normalized.includes("succeed") || normalized === "paid"
    ? "border-[#63d5aa]/20 bg-[#63d5aa]/[.08] text-[#7edbb8]"
    : normalized.includes("pending") || normalized.includes("transit") || normalized.includes("scheduled")
      ? "border-[#e2bd68]/20 bg-[#e2bd68]/[.07] text-[#d4b76f]"
      : normalized.includes("refund")
        ? "border-[#8f7dff]/25 bg-[#8f7dff]/[.09] text-[#aea2ff]"
        : normalized.includes("dispute") || normalized.includes("fail")
          ? "border-[#ff87a7]/20 bg-[#ff87a7]/[.07] text-[#e995ab]"
          : "border-white/[.08] bg-white/[.035] text-[#9297a2]";
  return <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-[9px] font-semibold", tone)}>{status}</span>;
}
