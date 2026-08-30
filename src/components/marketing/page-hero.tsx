import { ButtonLink } from "@/components/ui/button-link";

export function PageHero({ eyebrow, title, description, primary = true }: { eyebrow: string; title: string; description: string; primary?: boolean }) {
  return (
    <section className="page-orbit-hero relative isolate flex min-h-[620px] items-end overflow-hidden border-b border-white/[.09] pb-20 pt-36 sm:min-h-[700px] sm:pb-24">
      <div className="container-shell relative z-10">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-7 max-w-5xl text-balance text-5xl font-medium leading-[.92] text-[#f5f4ff] sm:text-7xl lg:text-8xl">{title}</h1>
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-end"><p className="max-w-2xl text-balance text-base leading-7 text-[#999bb3] sm:text-lg sm:leading-8">{description}</p>{primary && <div className="flex flex-col gap-3 sm:flex-row lg:justify-end"><ButtonLink href="/request-access">Request access</ButtonLink><ButtonLink href="/contact" variant="secondary">Talk to sales</ButtonLink></div>}</div>
      </div>
    </section>
  );
}
