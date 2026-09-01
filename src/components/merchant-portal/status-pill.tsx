import { cn } from "@/lib/utils";

export function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const tone = normalized.includes("succeed") || normalized === "paid"
    ? "border-[#d8eee5] bg-[#edf8f3] text-[#3f8b70]"
    : normalized.includes("pending") || normalized.includes("transit") || normalized.includes("scheduled")
      ? "border-[#e7e0bc] bg-[#fbf7e7] text-[#8d7838]"
      : normalized.includes("refund")
        ? "border-[#dedaf5] bg-[#f2efff] text-[#6859c8]"
        : normalized.includes("dispute") || normalized.includes("fail")
          ? "border-[#f0d9de] bg-[#fff0f3] text-[#ad5265]"
          : "border-[#e3e4e7] bg-[#f4f5f6] text-[#71757d]";
  return <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-[9px] font-semibold", tone)}>{status}</span>;
}

