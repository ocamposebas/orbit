"use client";

import { loadConnectAndInitialize } from "@stripe/connect-js";
import { ConnectAccountOnboarding, ConnectComponentsProvider } from "@stripe/react-connect-js";
import { ExternalLink, LoaderCircle, LockKeyhole, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { sentinelFetch } from "./client";

export type StripeEmbeddedSession = {
  clientSecret: string;
  publishableKey: string;
  expiresAt: number;
};

export function StripeEmbeddedOnboarding({ merchantId, merchantName, session, onExit }: { merchantId: string; merchantName: string; session: StripeEmbeddedSession; onExit: () => Promise<void> }) {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [closing, setClosing] = useState(false);
  const [openingHosted, setOpeningHosted] = useState(false);
  const [fallbackError, setFallbackError] = useState(false);
  const [connectInstance] = useState(() => {
    let initialClientSecret: string | undefined = session.clientSecret;
    return loadConnectAndInitialize({
      publishableKey: session.publishableKey,
      fetchClientSecret: async () => {
        if (initialClientSecret) {
          const clientSecret = initialClientSecret;
          initialClientSecret = undefined;
          return clientSecret;
        }
        const refreshed = await sentinelFetch<StripeEmbeddedSession>(`/api/sentinel/merchants/${merchantId}/stripe/embedded-session`, { method: "POST" });
        if (refreshed.publishableKey !== session.publishableKey) throw new Error("Stripe environment changed during onboarding");
        return refreshed.clientSecret;
      },
      appearance: {
        overlays: "dialog",
        variables: {
          fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
          fontSizeBase: "14px",
          spacingUnit: "12px",
          borderRadius: "10px",
          colorPrimary: "#8f7dff",
          colorBackground: "#0c0e12",
          colorText: "#eceef3",
          colorSecondaryText: "#858b96",
          colorDanger: "#dc8797",
          buttonPrimaryColorBackground: "#7d6cf2",
          buttonPrimaryColorBorder: "#7d6cf2",
          buttonPrimaryColorText: "#ffffff",
          buttonSecondaryColorBackground: "#151820",
          buttonSecondaryColorBorder: "#2b2e38",
          buttonSecondaryColorText: "#e1e3e8",
        },
      },
    });
  });

  async function close() {
    if (closing) return;
    setClosing(true);
    try {
      await onExit();
    } finally {
      setClosing(false);
    }
  }

  async function openHostedFallback() {
    if (openingHosted) return;
    setOpeningHosted(true); setFallbackError(false);
    try {
      const result = await sentinelFetch<{ url: string }>(`/api/sentinel/merchants/${merchantId}/stripe/onboarding`, { method: "POST" });
      window.location.assign(result.url);
    } catch {
      setFallbackError(true);
      setOpeningHosted(false);
    }
  }

  return <div className="mt-5 overflow-hidden border border-[#8588ef]/20 bg-[#0c0e12]">
    <div className="flex items-start gap-4 border-b border-white/[.07] p-5 sm:px-6">
      <span className="grid size-10 shrink-0 place-items-center rounded-md border border-[#8588ef]/20 bg-[#8588ef]/[.07]"><LockKeyhole className="size-4 text-[#9b9df7]" /></span>
      <div className="min-w-0 flex-1"><p className="text-[9px] font-semibold uppercase tracking-[.15em] text-[#8588ef]">Secure embedded verification</p><h3 className="mt-2 text-base font-medium text-[#eceeea]">Complete {merchantName}&apos;s Stripe application</h3><p className="mt-2 max-w-2xl text-[10px] leading-5 text-[#747983]">You remain inside ORBIT. Stripe securely collects and verifies identity, business, tax, document, and bank information; ORBIT never stores those sensitive values.</p></div>
      <button type="button" onClick={() => void close()} disabled={closing} className="grid size-9 shrink-0 place-items-center rounded-md border border-white/[.08] text-[#757a84] hover:bg-white/[.04] hover:text-white disabled:opacity-50" aria-label="Close Stripe onboarding"><X className="size-4" /></button>
    </div>
    <div className="relative min-h-72 bg-[#0c0e12] p-3 sm:p-5">
      {!ready && !loadError && <div className="absolute inset-0 z-10 grid place-items-center bg-[#0c0e12]"><div className="text-center"><LoaderCircle className="mx-auto size-5 animate-spin text-[#9698f3]" /><p className="mt-3 text-[10px] text-[#777c86]">Loading secure Stripe verification…</p></div></div>}
      {loadError ? <div className="grid min-h-72 place-items-center px-5 text-center"><div><p className="text-sm font-medium text-[#e2e4df]">Embedded verification could not load</p><p className="mx-auto mt-2 max-w-md text-[10px] leading-5 text-[#747983]">No information was submitted. You can retry by reopening this panel or continue with Stripe&apos;s secure hosted form.</p><button type="button" onClick={() => void openHostedFallback()} disabled={openingHosted} className="mt-5 inline-flex h-9 items-center gap-2 rounded-md border border-white/[.1] px-4 text-[10px] text-[#c6c8c3] hover:bg-white/[.04] disabled:opacity-50">{openingHosted ? "Opening Stripe…" : "Use secure Stripe fallback"}<ExternalLink className="size-3" /></button>{fallbackError && <p className="mt-3 text-[10px] text-[#d99595]">Stripe is temporarily unavailable. Close this panel and try again.</p>}</div></div> : <ConnectComponentsProvider connectInstance={connectInstance}><ConnectAccountOnboarding onExit={() => void close()} onLoaderStart={() => setReady(true)} onLoadError={() => { setReady(true); setLoadError(true); }} collectionOptions={{ fields: "eventually_due", futureRequirements: "include" }} /></ConnectComponentsProvider>}
    </div>
    <div className="flex items-center gap-2 border-t border-white/[.07] px-5 py-3 text-[9px] text-[#666b75] sm:px-6"><ShieldCheck className="size-3.5 text-[#71c9a9]" /><span>Encrypted and processed by Stripe. Status is confirmed from Stripe after you exit.</span></div>
  </div>;
}
