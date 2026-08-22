import { cn } from "@/lib/utils";

export function SectionHeading({ eyebrow, title, description, align = "left", className }: { eyebrow: string; title: string; description?: string; align?: "left" | "center"; className?: string }) {
  return (
    <div className={cn("max-w-3xl", align === "center" && "mx-auto text-center", className)}>
      <p className={cn("eyebrow", align === "center" && "justify-center")}>{eyebrow}</p>
      <h2 className="mt-5 text-balance text-[clamp(2rem,5vw,4.4rem)] font-medium leading-[.98] tracking-[-.055em] text-[#f2f0eb]">{title}</h2>
      {description && <p className="mt-6 max-w-2xl text-balance text-base leading-7 text-[#989ba3] sm:text-lg">{description}</p>}
    </div>
  );
}
