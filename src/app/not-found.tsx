import { ButtonLink } from "@/components/ui/button-link";

export default function NotFound() {
  return <section className="grid min-h-[70vh] place-items-center px-5 pb-20 pt-28 text-center"><div><p className="font-mono text-xs text-[#7c7f88]">404 / OUT OF RANGE</p><h1 className="mt-5 text-5xl font-medium tracking-[-.055em] sm:text-7xl">This page left orbit.</h1><p className="mx-auto mt-5 max-w-md text-sm leading-7 text-[#858891]">The route does not exist or may have moved.</p><div className="mt-8"><ButtonLink href="/">Return home</ButtonLink></div></div></section>;
}
