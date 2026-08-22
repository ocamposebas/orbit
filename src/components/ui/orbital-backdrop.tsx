import { cn } from "@/lib/utils";

export function OrbitalBackdrop({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden", className)}>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_48%_at_50%_35%,rgba(91,94,184,.18),transparent_68%)]" />
      <div className={cn("absolute left-1/2 top-[34%] -translate-x-1/2 rounded-[50%] border border-white/[.09]", compact ? "h-[390px] w-[900px]" : "h-[660px] w-[1500px]")} />
      <div className={cn("absolute left-1/2 top-[33%] -translate-x-1/2 rotate-[9deg] rounded-[50%] border border-white/[.055]", compact ? "h-[420px] w-[940px]" : "h-[720px] w-[1580px]")} />
      <div className={cn("absolute left-1/2 top-[36%] -translate-x-1/2 -rotate-[10deg] rounded-[50%] border border-[#8b8cff]/[.13]", compact ? "h-[350px] w-[820px]" : "h-[590px] w-[1380px]")} />
      <div className="absolute left-[calc(50%+31vw)] top-[29%] size-1.5 rounded-full bg-[#a8a9ff] shadow-[0_0_18px_3px_rgba(139,140,255,.55)]" />
      <div className="absolute inset-x-0 bottom-0 h-[38%] bg-[linear-gradient(to_bottom,transparent,#08090b_88%)]" />
    </div>
  );
}
