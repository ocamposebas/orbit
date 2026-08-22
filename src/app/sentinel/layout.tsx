import type { Metadata } from "next";
import { SentinelShell } from "@/components/sentinel/shell";
import { currentSession } from "@/sentinel/auth/session";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Sentinel", robots: { index: false, follow: false } };

export default async function Layout({ children }: { children: React.ReactNode }) { const session = await currentSession(); if (!session) redirect("/login?next=/sentinel"); return <SentinelShell workspace={session.organization.name} userName={session.user.name ?? session.user.email} role={session.role}>{children}</SentinelShell>; }
