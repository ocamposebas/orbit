"use client";

import { Check, Copy, PlugZap, ShieldAlert, Unplug } from "lucide-react";
import { useState } from "react";
import { sentinelFetch } from "./client";

export type WooCommerceInstallationSummary = {
  installationId: string;
  merchantId: string;
  origin: string;
  domain: string;
  environment: "live" | "test";
  enabled: boolean;
  hostedPaymentsEnabled: boolean;
  status: "connected" | "disabled" | "revoked";
  pluginVersion?: string | null;
  wooCommerceVersion?: string | null;
  wordPressVersion?: string | null;
  lastSeenAt?: string | null;
  lastPaymentAt?: string | null;
  lastEventStatus?: string | null;
  lastEventAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

type ConnectionCode = { code: string; expiresAt: string; environment: string };

export function WooCommercePaymentsCard({ merchantId, installations, environment, available, canManage, reload }: {
  merchantId: string;
  installations: WooCommerceInstallationSummary[];
  environment: "live" | "test";
  available: boolean;
  canManage: boolean;
  reload: () => Promise<void>;
}) {
  const [working, setWorking] = useState("");
  const [connection, setConnection] = useState<ConnectionCode>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  if (!available) return <section className="mt-7 max-w-4xl border border-[#d39a72]/20 bg-[#0c0e12] p-6"><div className="flex gap-4"><ShieldAlert className="size-4 text-[#d39a72]" /><div><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-[#696e77]">WooCommerce payments</p><h2 className="mt-2 text-base font-medium text-[#d39a72]">Database migration required</h2></div></div></section>;

  async function generateCode() {
    setWorking("code"); setError(""); setCopied(false);
    try {
      setConnection(await sentinelFetch<ConnectionCode>(`/api/sentinel/merchants/${merchantId}/woocommerce/connection-codes`, { method: "POST", body: JSON.stringify({ environment }) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to generate a connection code"); }
    finally { setWorking(""); }
  }

  async function copyCode() {
    if (!connection) return;
    await navigator.clipboard.writeText(connection.code);
    setCopied(true);
  }

  async function revoke(installationId: string) {
    if (!window.confirm("Revoke this WooCommerce installation? It will immediately stop creating new payments.")) return;
    setWorking(installationId); setError("");
    try {
      await sentinelFetch(`/api/sentinel/merchants/${merchantId}/woocommerce/installations/${installationId}/revoke`, { method: "POST" });
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to revoke the installation"); }
    finally { setWorking(""); }
  }

  return <section id="woocommerce-payments" className="mt-7 max-w-4xl border border-white/[.075] bg-[#0c0e12]">
    <header className="flex flex-col gap-5 border-b border-white/[.065] p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6"><div className="flex gap-4"><span className="grid size-10 place-items-center rounded-md border border-white/[.09] bg-white/[.025]"><PlugZap className="size-4 text-[#888bf2]" /></span><div><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-[#696e77]">ORBIT Payments for WooCommerce</p><h2 className="mt-2 text-base font-medium">{installations.some((item) => item.status === "connected") ? "Connected" : "Not connected"}</h2><p className="mt-2 max-w-xl text-[11px] leading-5 text-[#777b84]">Connect the WordPress plugin with a short-lived code. Hosted checkout, Stripe credentials, fees, and webhook processing remain inside ORBIT.</p></div></div>{canManage && <button onClick={() => void generateCode()} disabled={Boolean(working)} className="h-9 rounded-md bg-[#ecece8] px-4 text-[10px] font-medium text-black disabled:opacity-50">{working === "code" ? "Generating…" : "Generate connection code"}</button>}</header>
    <div className="p-5 sm:p-6">
      {connection && <div className="mb-5 border border-[#777aea]/20 bg-[#777aea]/[.035] p-4"><p className="text-[9px] uppercase tracking-[.14em] text-[#8f91ef]">One-time code</p><div className="mt-2 flex flex-wrap items-center gap-2"><code className="rounded border border-white/[.1] bg-black/20 px-3 py-2 text-sm tracking-[.08em] text-white">{connection.code}</code><button onClick={() => void copyCode()} className="inline-flex h-9 items-center gap-2 rounded-md border border-white/[.1] px-3 text-[10px] text-[#c2c4bf]">{copied ? <Check className="size-3" /> : <Copy className="size-3" />}{copied ? "Copied" : "Copy"}</button></div><p className="mt-2 text-[9px] text-[#60646d]">Expires {new Date(connection.expiresAt).toLocaleString()}. It can be exchanged only once.</p></div>}
      {error && <p role="alert" className="mb-4 text-[10px] text-[#d17777]">{error}</p>}
      {installations.length ? <div className="space-y-3">{installations.map((installation) => <article key={installation.installationId} className="border border-white/[.065] p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><h3 className="text-xs text-[#d8d9d4]">{installation.domain}</h3><span className={`rounded border px-1.5 py-0.5 text-[8px] uppercase tracking-[.1em] ${installation.status === "connected" ? "border-[#6fc39d]/20 text-[#6fc39d]" : "border-[#d17777]/20 text-[#d17777]"}`}>{installation.status}</span></div><p className="mt-1 break-all font-mono text-[8px] text-[#5f646d]">{installation.installationId}</p></div>{canManage && installation.status === "connected" && <button onClick={() => void revoke(installation.installationId)} disabled={Boolean(working)} className="inline-flex h-8 items-center gap-2 rounded-md border border-[#d17777]/20 px-3 text-[9px] text-[#d99595] disabled:opacity-50"><Unplug className="size-3" />{working === installation.installationId ? "Revoking…" : "Revoke"}</button>}</div><dl className="mt-4 grid gap-px overflow-hidden bg-white/[.06] sm:grid-cols-3"><Metric label="Environment" value={installation.environment} /><Metric label="Plugin" value={installation.pluginVersion ?? "Not reported"} /><Metric label="Hosted payments" value={installation.hostedPaymentsEnabled ? "Enabled" : "Disabled"} /><Metric label="Last heartbeat" value={installation.lastSeenAt ? new Date(installation.lastSeenAt).toLocaleString() : "Never"} /><Metric label="Last payment" value={installation.lastPaymentAt ? new Date(installation.lastPaymentAt).toLocaleString() : "None"} /><Metric label="Last event" value={installation.lastEventStatus ?? "None"} /></dl></article>)}</div> : <p className="text-[11px] text-[#777b84]">No WooCommerce plugin installation has been connected yet.</p>}
      {!canManage && <p className="mt-4 text-[10px] text-[#62666e]">An organization owner or admin can connect or revoke installations.</p>}
    </div>
  </section>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="bg-[#0c0e12] p-3"><dt className="text-[8px] uppercase tracking-[.12em] text-[#555a62]">{label}</dt><dd className="mt-2 text-[9px] capitalize text-[#b8bab5]">{value}</dd></div>;
}
