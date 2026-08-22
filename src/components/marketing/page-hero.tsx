import { ButtonLink } from "@/components/ui/button-link";
import { OrbitalBackdrop } from "@/components/ui/orbital-backdrop";

export function PageHero({ eyebrow, title, description, primary = true }: { eyebrow: string; title: string; description: string; primary?: boolean }) {
  return (
    <section className="relative isolate overflow-hidden border-b border-white/[.07] pb-20 pt-32 sm:pb-28 sm:pt-40">
      <OrbitalBackdrop compact />
      <div className="container-shell">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-7 max-w-5xl text-balance text-[clamp(3rem,8vw,7.4rem)] font-medium leading-[.9] tracking-[-.07em]">{title}</h1>
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-end"><p className="max-w-2xl text-balance text-base leading-7 text-[#989ba3] sm:text-lg sm:leading-8">{description}</p>{primary && <div className="flex gap-3 lg:justify-end"><ButtonLink href="/request-access">Request access</ButtonLink><ButtonLink href="/contact" variant="secondary">Talk to sales</ButtonLink></div>}</div>
      </div>
    </section>
  );
}
