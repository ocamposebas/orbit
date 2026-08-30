import type { Metadata } from "next";
import { LoginForm } from "@/components/forms/login-form";
import { Logo } from "@/components/ui/logo";
import { currentSession } from "@/sentinel/auth/session";
import { safeLoginContinuation } from "@/sentinel/auth/redirects";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Sign In", description: "Sign in to your ORBIT workspace." };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const query = await searchParams;
  const nextPath = safeLoginContinuation(query.next);
  if (await currentSession()) redirect(nextPath);
  return <section className="page-orbit-hero relative grid min-h-[calc(100vh-1px)] place-items-center overflow-hidden px-4 pb-20 pt-28"><div className="relative z-10 w-full max-w-[410px] rounded-[6px] border border-white/[.1] bg-[#090a0c]/90 p-6 shadow-[0_30px_100px_rgba(0,0,0,.55)] backdrop-blur-xl sm:p-9"><Logo/><h1 className="mt-12 text-3xl font-medium">Welcome back.</h1><p className="mt-2 text-sm text-[#89857f]">Sign in to your ORBIT workspace.</p><div className="mt-8"><LoginForm nextPath={nextPath}/></div></div></section>;
}
