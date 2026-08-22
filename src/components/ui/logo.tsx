import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" aria-label="ORBIT home" className="inline-flex items-center text-[15px] font-semibold tracking-[-.025em] text-[#eceae5] transition-colors hover:text-white">
      ORBIT
    </Link>
  );
}
