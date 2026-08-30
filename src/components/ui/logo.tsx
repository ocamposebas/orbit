import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" aria-label="ORBIT home" className="group inline-flex items-center gap-2.5 text-[14px] font-semibold text-[#eceae5] transition-colors hover:text-white">
      <span className="relative size-[17px] rounded-full border border-white/35" aria-hidden="true"><span className="absolute -right-0.5 top-0 size-1.5 rounded-full bg-[#ff6547] shadow-[0_0_10px_rgba(255,101,71,.7)]" /></span>
      ORBIT
    </Link>
  );
}
