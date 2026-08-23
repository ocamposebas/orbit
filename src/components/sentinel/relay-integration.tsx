"use client";

import { Link2, RefreshCw, ShieldAlert, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import { sentinelFetch } from "./client";

export type RelayIntegration = {
  id: string;
  merchantId: string;
  baseUrl: string;
  environment: "PRODUCTION" | "STAGING";
  connectionEnabled: boolean;
  connectionStatus: string;
  relayVersion?: string | null;
  woocommerceAvailable?: boolean | null;
  lastHealthCheckAt?: string | null;
  lastSuccessfulRequestAt?: string | null;
  lastLatencyMs?: number | null;
  lastErrorCode?: string | null;
  signingConfigured: boolean;
  createdAt: string;
  updatedAt: string;
};

type VerifiedRelayOrder = {
  orderId: number;
  status: string;
  currency: string;
  totalMinor: number;
  paymentRequired: boolean;
  privateAuthentication: "VERIFIED";
};

type PreparedPaymentTransaction = {
  id: string;
  wooOrderId: string;
  amountMinor: number;
  currency: string;
  platformFeeBps: number;
  platformFeeMinor: number;
  status: string;
  stripeAccountStatus: string;
  cardPaymentsStatus: string;
  stripeReadiness: "READY" | "STRIPE_NOT_READY";
};

const statusCopy: Record<string, { title: string; detail: string; tone: string }> = {
  NOT_CONFIGURED: { title: "Not configured", detail: "Connect this merchant's WooCommerce backend to ORBIT.", tone: "text-[#8b8f98]" },
  CONFIGURED: { title: "Configured", detail: "Configuration is saved. Test the connection to verify Relay and WooCommerce availability.", tone: "text-[#8f91ef]" },
  CONNECTED: { title: "Connected", detail: "ORBIT Relay and WooCommerce are reachable.", tone: "text-[#6fc39d]" },
  UNREACHABLE: { title: "Unreachable", detail: "ORBIT could not reach the configured WooCommerce backend.", tone: "text-[#d17777]" },
  WOO_UNAVAILABLE: { title: "WooCommerce unavailable", detail: "The Relay plugin responded, but WooCommerce is unavailable.", tone: "text-[#d39a72]" },
  RELAY_UNAVAILABLE: { title: "Relay unavailable", detail: "The configured health endpoint did not report an available ORBIT Relay.", tone: "text-[#d17777]" },
  AUTH_NOT_TESTED: { title: "Authentication not tested", detail: "The signing secret is stored. Verify a WooCommerce order to test private HMAC authentication.", tone: "text-[#c8ad6b]" },
  ERROR: { title: "Connection error", detail: "The Relay returned an invalid or unexpected health response.", tone: "text-[#d17777]" },
};

export function RelayIntegrationCard({ merchantId, merchantName, platformFeeBps, integration, available, canManage, reload }: { merchantId: string; merchantName: string; platformFeeBps?: number | null; integration?: RelayIntegration; available: boolean; canManage: boolean; reload: () => Promise<void> }) {
  const [showConfig, setShowConfig] = useState(false);
  const [working, setWorking] = useState<"test" | "">("");
  const [notice, setNotice] = useState("");
  const status = !integration
    ? statusCopy.NOT_CONFIGURED
    : !integration.connectionEnabled
      ? { title: "Configured / disabled", detail: "Relay requests are disabled for this merchant.", tone: "text-[#8b8f98]" }
      : statusCopy[integration.connectionStatus] ?? statusCopy.ERROR;

  if (!available) {
    return <section className="mt-7 max-w-4xl"><div className="border border-[#d39a72]/20 bg-[#0c0e12] p-6"><div className="flex gap-4"><span className="grid size-10 shrink-0 place-items-center rounded-md border border-[#d39a72]/20 bg-[#d39a72]/[.04]"><ShieldAlert className="size-4 text-[#d39a72]" /></span><div><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-[#696e77]">ORBIT Relay</p><h2 className="mt-2 text-base font-medium text-[#d39a72]">Integration setup required</h2><p className="mt-2 text-[11px] leading-5 text-[#777b84]">The WooCommerce Relay database migration has not been applied in this environment.</p></div></div></div></section>;
  }

  async function testConnection() {
    setWorking("test");
    setNotice("");
    try {
      const result = await sentinelFetch<{ integration: RelayIntegration & { ok: boolean; message: string } }>(`/api/sentinel/merchants/${merchantId}/relay/test`, { method: "POST" });
      setNotice(result.integration.message);
      await reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to test ORBIT Relay");
    } finally {
      setWorking("");
    }
  }

  function openConfiguration() {
    setNotice("");
    setShowConfig(true);
  }

  return <>
    <section id="orbit-relay" className="mt-7 max-w-4xl">
      <div className="border border-white/[.075] bg-[#0c0e12]">
        <div className="flex flex-col gap-5 border-b border-white/[.065] p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
          <div className="flex gap-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-md border border-white/[.09] bg-white/[.025]"><Link2 className="size-4 text-[#6fc39d]" /></span>
            <div><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-[#696e77]">ORBIT Relay</p><h2 className={cn("mt-2 text-base font-medium", status.tone)}>{status.title}</h2><p className="mt-2 max-w-xl text-[11px] leading-5 text-[#777b84]">{status.detail}</p></div>
          </div>
          {integration && <span className="self-start rounded border border-white/[.08] px-2 py-1 font-mono text-[8px] uppercase tracking-[.1em] text-[#626771]">{integration.environment}</span>}
        </div>
        <div className="p-5 sm:p-6">
          {integration ? <>
            <div className="grid gap-px overflow-hidden border border-white/[.06] bg-white/[.06] sm:grid-cols-3">
              <RelayMetric label="WooCommerce" value={integration.woocommerceAvailable === true ? "Reachable" : integration.woocommerceAvailable === false ? "Unavailable" : "Not tested"} />
              <RelayMetric label="Relay plugin" value={integration.relayVersion ? "Online" : "Not tested"} />
              <RelayMetric label="Relay version" value={integration.relayVersion ?? "Not reported"} />
              <RelayMetric label="Environment" value={integration.environment.toLowerCase()} />
              <RelayMetric label="Signing" value={integration.signingConfigured ? "Configured" : "Not configured"} />
              <RelayMetric label="Response latency" value={integration.lastLatencyMs === undefined || integration.lastLatencyMs === null ? "Not tested" : `${integration.lastLatencyMs} ms`} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {canManage && <button type="button" onClick={() => void testConnection()} disabled={!integration.connectionEnabled || Boolean(working)} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#ecece8] px-4 text-[10px] font-medium text-black disabled:opacity-50"><RefreshCw className={cn("size-3", working === "test" && "animate-spin")} />{working === "test" ? "Testing..." : "Test connection"}</button>}
              {canManage && <button type="button" onClick={openConfiguration} disabled={Boolean(working)} className="h-9 rounded-md border border-white/[.1] px-3.5 text-[10px] text-[#c2c4bf] disabled:opacity-50">Edit configuration</button>}
              {!canManage && <p className="text-[10px] text-[#62666e]">An organization owner or admin can manage this integration.</p>}
              <span className="ml-auto text-[9px] text-[#555a62]">Last health check {integration.lastHealthCheckAt ? new Date(integration.lastHealthCheckAt).toLocaleString() : "never"}</span>
            </div>
          </> : <div><p className="text-[11px] leading-5 text-[#777b84]">Connect {merchantName}&apos;s WooCommerce backend to ORBIT. Health checks verify Relay and WooCommerce availability; order diagnostics verify the private HMAC connection.</p>{canManage ? <button type="button" onClick={openConfiguration} className="mt-5 h-9 rounded-md bg-[#ecece8] px-4 text-[10px] font-medium text-black">Configure Relay</button> : <p className="mt-4 text-[10px] text-[#62666e]">An organization owner or admin can configure Relay.</p>}</div>}
          {notice && <p aria-live="polite" className={cn("mt-4 text-[10px]", integration?.connectionStatus === "CONNECTED" ? "text-[#6fc39d]" : "text-[#d39a72]")}>{notice}</p>}
          {integration && canManage && <><RelayDiagnostics merchantId={merchantId} enabled={integration.connectionEnabled} /><PaymentPreparation merchantId={merchantId} enabled={integration.connectionEnabled} platformFeeBps={platformFeeBps} /></>}
        </div>
      </div>
      <p className="mt-3 text-[9px] leading-4 text-[#555a62]">Relay health is independent from Stripe verification. Signing secrets remain server-side and are used only for private Relay requests.</p>
    </section>
    {showConfig && <RelayConfigurationDialog merchantId={merchantId} platformFeeBps={platformFeeBps} integration={integration} onClose={() => setShowConfig(false)} onSaved={async () => { setShowConfig(false); setNotice("Relay configuration saved."); await reload(); }} />}
  </>;
}

function RelayDiagnostics({ merchantId, enabled }: { merchantId: string; enabled: boolean }) {
  const [orderId, setOrderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<VerifiedRelayOrder>();

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setOrder(undefined);
    try {
      const result = await sentinelFetch<{ order: VerifiedRelayOrder }>(`/api/sentinel/merchants/${merchantId}/relay/orders/verify`, {
        method: "POST",
        body: JSON.stringify({ orderId: orderId.trim() }),
      });
      setOrder(result.order);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to verify WooCommerce order");
    } finally {
      setBusy(false);
    }
  }

  return <section aria-labelledby="relay-diagnostics-title" className="mt-6 border-t border-white/[.07] pt-5">
    <p className="text-[9px] font-semibold uppercase tracking-[.14em] text-[#777b84]">Relay Diagnostics</p>
    <h3 id="relay-diagnostics-title" className="mt-2 text-sm font-medium text-[#d8d9d4]">Private WooCommerce order verification</h3>
    <p className="mt-1.5 max-w-2xl text-[10px] leading-5 text-[#62666e]">Enter only the WooCommerce order ID. Status, currency, and total are retrieved directly from WooCommerce through the signed Relay request.</p>
    <form onSubmit={verify} className="mt-4 flex max-w-md flex-col gap-2 sm:flex-row sm:items-end">
      <label className="flex-1 text-[10px] text-[#81858d]">WooCommerce Order ID<input required name="orderId" inputMode="numeric" pattern="[1-9][0-9]{0,15}" value={orderId} onChange={(event) => setOrderId(event.target.value)} placeholder="1234" className="mt-1.5 h-10 w-full rounded-md border border-white/[.1] bg-white/[.025] px-3 font-mono text-xs text-white outline-none focus:border-[#7779ea]" /></label>
      <button type="submit" disabled={!enabled || busy} className="h-10 rounded-md bg-[#ecece8] px-4 text-[10px] font-medium text-black disabled:opacity-50">{busy ? "Verifying..." : "Verify order"}</button>
    </form>
    {!enabled && <p className="mt-2 text-[10px] text-[#d39a72]">Enable ORBIT Relay before verifying an order.</p>}
    {error && <p role="alert" className="mt-3 text-[10px] text-[#d17777]">{error}</p>}
    {order && <div aria-live="polite" className="mt-4 max-w-xl border border-[#6fc39d]/20 bg-[#6fc39d]/[.025] p-4">
      <h4 className="text-sm font-medium text-[#d8d9d4]">Order #{order.orderId}</h4>
      <dl className="mt-3 grid gap-px overflow-hidden border border-white/[.06] bg-white/[.06] sm:grid-cols-2">
        <RelayResult label="Status" value={order.status} />
        <RelayResult label="Currency" value={order.currency} />
        <RelayResult label="Authoritative total" value={formatMinorAmount(order.totalMinor, order.currency)} />
        <RelayResult label="Payment required" value={order.paymentRequired ? "Yes" : "No"} />
        <RelayResult label="Private authentication" value={order.privateAuthentication === "VERIFIED" ? "Verified" : "Unavailable"} />
      </dl>
    </div>}
  </section>;
}

function PaymentPreparation({ merchantId, enabled, platformFeeBps }: { merchantId: string; enabled: boolean; platformFeeBps?: number | null }) {
  const [wooOrderId, setWooOrderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [transaction, setTransaction] = useState<PreparedPaymentTransaction>();

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setTransaction(undefined);
    try {
      const result = await sentinelFetch<{ transaction: PreparedPaymentTransaction }>(`/api/sentinel/merchants/${merchantId}/payments/prepare`, {
        method: "POST",
        body: JSON.stringify({ wooOrderId: wooOrderId.trim() }),
      });
      setTransaction(result.transaction);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to prepare the ORBIT transaction");
    } finally {
      setBusy(false);
    }
  }

  return <section aria-labelledby="payment-preparation-title" className="mt-6 border-t border-white/[.07] pt-5">
    <p className="text-[9px] font-semibold uppercase tracking-[.14em] text-[#777b84]">Prepare payment</p>
    <h3 id="payment-preparation-title" className="mt-2 text-sm font-medium text-[#d8d9d4]">ORBIT Payments Core</h3>
    <p className="mt-1.5 max-w-2xl text-[10px] leading-5 text-[#62666e]">Creates or reuses an ORBIT transaction from the authoritative WooCommerce order. No Stripe payment is created.</p>
    <form onSubmit={prepare} className="mt-4 flex max-w-md flex-col gap-2 sm:flex-row sm:items-end">
      <label className="flex-1 text-[10px] text-[#81858d]">Woo Order ID<input required inputMode="numeric" pattern="[1-9][0-9]{0,15}" value={wooOrderId} onChange={(event) => setWooOrderId(event.target.value)} placeholder="1234" className="mt-1.5 h-10 w-full rounded-md border border-white/[.1] bg-white/[.025] px-3 font-mono text-xs text-white outline-none focus:border-[#7779ea]" /></label>
      <button type="submit" disabled={!enabled || platformFeeBps == null || busy} className="h-10 rounded-md bg-[#ecece8] px-4 text-[10px] font-medium text-black disabled:opacity-50">{busy ? "Preparing..." : "Prepare transaction"}</button>
    </form>
    {platformFeeBps == null && <p className="mt-2 text-[10px] text-[#d39a72]">Configure platformFeeBps in Edit configuration before preparing a transaction.</p>}
    {error && <p role="alert" className="mt-3 text-[10px] text-[#d17777]">{error}</p>}
    {transaction && <div aria-live="polite" className="mt-4 max-w-2xl border border-[#8588ef]/20 bg-[#8588ef]/[.025] p-4">
      {transaction.stripeReadiness === "STRIPE_NOT_READY" && <p className="mb-3 border border-[#d39a72]/20 bg-[#d39a72]/[.04] px-3 py-2 font-mono text-[10px] text-[#d39a72]">STRIPE_NOT_READY</p>}
      <dl className="grid gap-px overflow-hidden border border-white/[.06] bg-white/[.06] sm:grid-cols-2">
        <RelayResult label="ORBIT Transaction" value={transaction.id} />
        <RelayResult label="Woo Order" value={`#${transaction.wooOrderId}`} />
        <RelayResult label="Total" value={formatMinorAmount(transaction.amountMinor, transaction.currency)} />
        <RelayResult label="Currency" value={transaction.currency} />
        <RelayResult label="Stripe account status" value={transaction.stripeAccountStatus} />
        <RelayResult label="Card payments status" value={transaction.cardPaymentsStatus} />
        <RelayResult label="ORBIT fee %" value={`${(transaction.platformFeeBps / 100).toFixed(2)}%`} />
        <RelayResult label="ORBIT fee amount" value={formatMinorAmount(transaction.platformFeeMinor, transaction.currency)} />
        <RelayResult label="Transaction status" value={transaction.status} />
        <RelayResult label="Stripe readiness" value={transaction.stripeReadiness} />
      </dl>
    </div>}
  </section>;
}

function formatMinorAmount(totalMinor: number, currency: string) {
  try {
    const formatter = new Intl.NumberFormat(undefined, { style: "currency", currency });
    const exponent = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(totalMinor / (10 ** exponent));
  } catch {
    return `${currency} ${totalMinor}`;
  }
}

function RelayResult({ label, value }: { label: string; value: string }) {
  return <div className="bg-[#0c0e12] p-3"><dt className="text-[8px] uppercase tracking-[.12em] text-[#555a62]">{label}</dt><dd className="mt-1.5 text-[10px] text-[#b8bab5]">{value}</dd></div>;
}

function RelayConfigurationDialog({ merchantId, platformFeeBps, integration, onClose, onSaved }: { merchantId: string; platformFeeBps?: number | null; integration?: RelayIntegration; onClose: () => void; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [replaceSecret, setReplaceSecret] = useState(!integration?.signingConfigured);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const signingSecret = String(form.get("signingSecret") ?? "");
    const body = { baseUrl: form.get("baseUrl"), environment: form.get("environment"), connectionEnabled: form.get("connectionEnabled") === "on", platformFeeBps: Number(form.get("platformFeeBps")), ...(signingSecret ? { signingSecret } : {}) };
    try {
      await sentinelFetch(`/api/sentinel/merchants/${merchantId}/relay`, { method: "PUT", body: JSON.stringify(body) });
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save Relay configuration");
    } finally {
      setBusy(false);
    }
  }

  return <div role="dialog" aria-modal="true" aria-labelledby="relay-config-title" className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-black/70 p-4">
    <div className="w-full max-w-lg border border-white/[.1] bg-[#0d0f13] shadow-2xl">
      <div className="flex items-start justify-between border-b border-white/[.07] p-5"><div><p className="text-[9px] uppercase tracking-[.15em] text-[#6fc39d]">ORBIT Relay</p><h2 id="relay-config-title" className="mt-1 text-lg font-medium">{integration ? "Edit configuration" : "Configure Relay"}</h2></div><button type="button" onClick={onClose} aria-label="Close"><X className="size-4 text-[#777b83]" /></button></div>
      <form onSubmit={submit} className="space-y-4 p-5">
        <label className="block text-[10px] text-[#81858d]">WooCommerce URL<input required name="baseUrl" type="url" defaultValue={integration?.baseUrl ?? ""} placeholder="https://wp.example.com" className="mt-1.5 h-10 w-full rounded-md border border-white/[.1] bg-white/[.025] px-3 text-xs text-white outline-none focus:border-[#7779ea]" /><span className="mt-1.5 block leading-4 text-[#5f646d]">Canonical WooCommerce origin only. Production requires HTTPS.</span></label>
        <label className="block text-[10px] text-[#81858d]">Environment<select name="environment" defaultValue={integration?.environment ?? "PRODUCTION"} className="mt-1.5 h-10 w-full rounded-md border border-white/[.1] bg-[#111319] px-3 text-xs text-white outline-none focus:border-[#7779ea]"><option value="PRODUCTION">Production</option><option value="STAGING">Staging</option></select></label>
        <label className="block text-[10px] text-[#81858d]">Platform fee (basis points)<input required name="platformFeeBps" type="number" min="0" max="10000" step="1" defaultValue={platformFeeBps ?? ""} placeholder="190" className="mt-1.5 h-10 w-full rounded-md border border-white/[.1] bg-white/[.025] px-3 text-xs text-white outline-none focus:border-[#7779ea]" /><span className="mt-1.5 block leading-4 text-[#5f646d]">190 basis points equals 1.90%. This setting is stored per merchant.</span></label>
        <div className="text-[10px] text-[#81858d]"><div className="flex items-center justify-between"><span>Signing secret</span>{integration?.signingConfigured && !replaceSecret && <button type="button" onClick={() => setReplaceSecret(true)} className="text-[#9b9df1] hover:text-white">Replace signing secret</button>}</div>{replaceSecret ? <input required name="signingSecret" type="password" minLength={16} maxLength={1024} autoComplete="new-password" placeholder="Paste the WordPress Relay signing secret" className="mt-1.5 h-10 w-full rounded-md border border-white/[.1] bg-white/[.025] px-3 text-xs text-white outline-none focus:border-[#7779ea]" /> : <div className="mt-1.5 flex h-10 items-center rounded-md border border-white/[.08] bg-white/[.02] px-3 text-xs text-[#6fc39d]">Configured</div>}<span className="mt-1.5 block leading-4 text-[#5f646d]">The saved secret is encrypted and is never returned to this browser.</span></div>
        <label className="flex items-center gap-3 border border-white/[.07] p-3 text-[10px] text-[#a5a8a1]"><input name="connectionEnabled" type="checkbox" defaultChecked={integration?.connectionEnabled ?? true} className="size-4 accent-[#7779ea]" />Enable Relay</label>
        {error && <p className="text-xs text-[#dd8b8b]">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-white/[.07] pt-4"><button type="button" onClick={onClose} className="h-9 rounded-md border border-white/[.09] px-3 text-[11px] text-[#92959d]">Cancel</button><button disabled={busy} className="h-9 rounded-md bg-[#edede9] px-4 text-[11px] font-medium text-black disabled:opacity-50">{busy ? "Saving..." : "Save configuration"}</button></div>
      </form>
    </div>
  </div>;
}

function RelayMetric({ label, value }: { label: string; value: string }) {
  return <div className="bg-[#0c0e12] p-4"><p className="text-[8px] uppercase tracking-[.12em] text-[#555a62]">{label}</p><p className="mt-2 text-[10px] capitalize text-[#b8bab5]">{value}</p></div>;
}
