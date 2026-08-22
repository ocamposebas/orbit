import type { Metadata } from "next";
import { LoginForm } from "@/components/forms/login-form";
import { Logo } from "@/components/ui/logo";
import { OrbitalBackdrop } from "@/components/ui/orbital-backdrop";

export const metadata: Metadata = { title: "Sign In", description: "Sign in to your ORBIT workspace." };

export default function LoginPage() {
  return <section className="relative grid min-h-[calc(100vh-1px)] place-items-center overflow-hidden px-4 pb-20 pt-28"><OrbitalBackdrop compact/><div className="w-full max-w-[410px] rounded-2xl border border-white/[.09] bg-[#0d0f12]/95 p-6 shadow-[0_30px_100px_rgba(0,0,0,.45)] sm:p-9"><Logo/><h1 className="mt-12 text-3xl font-medium tracking-[-.045em]">Welcome back.</h1><p className="mt-2 text-sm text-[#777a83]">Sign in to your ORBIT workspace.</p><div className="mt-8"><LoginForm/></div></div></section>;
}
