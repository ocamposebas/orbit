import Link from "next/link";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" aria-label="ORBIT home" className="group inline-flex items-center">
      <span className="text-[14px] font-semibold tracking-[.26em] text-[#f4f2ed] transition-colors group-hover:text-white">ORBIT</span>
      {!compact && <span aria-hidden="true" className="ml-2.5 mt-[-8px] size-1 rounded-full bg-[#9a9bff] shadow-[0_0_10px_rgba(154,155,255,.75)]" />}
    </Link>
  );
}
