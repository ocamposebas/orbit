"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Elements, ExpressCheckoutElement, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type StripeElementsOptions } from "@stripe/stripe-js";
import { Check, LockKeyhole, ShieldCheck } from "lucide-react";
import styles from "./public-payment-checkout.module.css";

type PublicSession = {
  id: string;
  merchantName: string;
  amountMinor: number;
  currency: string;
  email: string | null;
  paymentStatus: string;
  syncStatus: string;
  checkoutMode: "STRIPE_CHECKOUT" | "ORBIT_HOSTED";
  expired: boolean;
};

type CheckoutConfiguration = {
  clientSecret: string;
  publishableKey: string;
  connectedAccountId: string;
};

function money(amountMinor: number, currency: string) {
  const formatter = new Intl.NumberFormat(undefined, { style: "currency", currency });
  const exponent = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(amountMinor / 10 ** exponent);
}

function Completion({ sessionId, message }: { sessionId: string; message: string }) {
  const router = useRouter();
  useEffect(() => {
    const poll = window.setInterval(async () => {
      const response = await fetch(`/api/integrations/ecwid/sessions/${encodeURIComponent(sessionId)}/status`, { cache: "no-store" });
      if (!response.ok) return;
      const status = await response.json() as { paymentStatus?: string; syncStatus?: string };
      if (status.syncStatus === "PAID_SYNCED" || status.syncStatus === "INCOMPLETE_SYNCED") {
        router.push(`/api/integrations/ecwid/return/${encodeURIComponent(sessionId)}`);
      }
    }, 2_500);
    return () => window.clearInterval(poll);
  }, [router, sessionId]);
  return <div className={styles.completion}><span className={styles.spinner} /><h2>{message}</h2><p>Please keep this page open while we confirm the order.</p></div>;
}

function PaymentForm({ session }: { session: PublicSession }) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const confirm = useCallback(async () => {
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setMessage(null);
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/api/integrations/ecwid/return/${encodeURIComponent(session.id)}` },
      redirect: "if_required",
    });
    if (result.error) {
      setMessage(result.error.message ?? "Your payment could not be completed. Please check the details and try again.");
      setBusy(false);
      return;
    }
    router.push(`/api/integrations/ecwid/return/${encodeURIComponent(session.id)}`);
  }, [busy, elements, router, session.id, stripe]);

  return <>
    <div className={styles.express}>
      <span>Express checkout</span>
      <ExpressCheckoutElement onConfirm={() => void confirm()} options={{ layout: { maxColumns: 2, maxRows: 2 } }} />
    </div>
    <div className={styles.divider}><span>or pay another way</span></div>
    <form onSubmit={(event) => { event.preventDefault(); void confirm(); }}>
      <PaymentElement options={{ layout: "tabs", defaultValues: { billingDetails: { email: session.email ?? undefined } } }} />
      {message ? <div className={styles.error} role="alert">{message}</div> : null}
      <button className={styles.payButton} type="submit" disabled={!stripe || !elements || busy}>
        {busy ? "Processing…" : `Pay ${money(session.amountMinor, session.currency)}`}
      </button>
    </form>
  </>;
}

export function PublicPaymentCheckout({ session }: { session: PublicSession }) {
  const completed = session.checkoutMode === "STRIPE_CHECKOUT" || session.paymentStatus === "SUCCEEDED" || session.syncStatus.endsWith("SYNC_PENDING") || session.syncStatus === "PAID_SYNCED";
  const [configuration, setConfiguration] = useState<CheckoutConfiguration | null>(null);
  const [loading, setLoading] = useState(!session.expired && !completed);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.expired || completed) return;
    let active = true;
    void fetch(`/api/integrations/ecwid/sessions/${encodeURIComponent(session.id)}/checkout`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store",
    }).then(async (response) => {
      const body = await response.json().catch(() => ({})) as CheckoutConfiguration & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The secure payment service is temporarily unavailable.");
      if (active) setConfiguration(body);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "The secure payment service is temporarily unavailable.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [completed, session.expired, session.id]);

  const stripePromise = useMemo(() => configuration
    ? loadStripe(configuration.publishableKey, { stripeAccount: configuration.connectedAccountId })
    : null, [configuration]);
  const elementsOptions = useMemo<StripeElementsOptions | undefined>(() => configuration ? ({
    clientSecret: configuration.clientSecret,
    appearance: {
      theme: "night",
      variables: { colorPrimary: "#e43d4e", colorBackground: "#111115", colorText: "#f7f4f2", colorDanger: "#ff6b78", borderRadius: "10px", fontFamily: "Inter, system-ui, sans-serif" },
      rules: { ".Input": { border: "1px solid rgba(255,255,255,.14)", boxShadow: "none" }, ".Input:focus": { border: "1px solid #e43d4e", boxShadow: "0 0 0 2px rgba(228,61,78,.16)" } },
    },
  }) : undefined, [configuration]);

  return <main className={styles.shell}>
    <div className={styles.backdrop} />
    <section className={styles.checkout}>
      <aside className={styles.summary}>
        <div className={styles.brand}><span className={styles.brandMark}>{session.merchantName.slice(0, 1).toUpperCase()}</span><span>{session.merchantName}</span></div>
        <div className={styles.orderLabel}>Secure checkout</div>
        <h1>{money(session.amountMinor, session.currency)}</h1>
        <p className={styles.orderReference}>Complete your order with {session.merchantName}.</p>
        <div className={styles.total}><span>Total</span><strong>{money(session.amountMinor, session.currency)}</strong></div>
        <div className={styles.trustList}>
          <span><ShieldCheck size={17} /> Protected payment</span>
          <span><LockKeyhole size={17} /> Encrypted by Stripe</span>
          <span><Check size={17} /> Merchant verified by ORBIT</span>
        </div>
      </aside>
      <div className={styles.payment}>
        <header><div className={styles.secure}><LockKeyhole size={15} /> Secure payment</div><h2>Choose how to pay</h2><p>Eligible wallets appear automatically for your device.</p></header>
        {session.expired ? <div className={styles.error} role="alert">This payment session has expired. Return to the store and start checkout again.</div> : null}
        {completed ? <Completion sessionId={session.id} message="Confirming your order" /> : null}
        {!completed && loading ? <div className={styles.loading}><span className={styles.spinner} />Preparing secure payment…</div> : null}
        {!completed && error ? <div className={styles.error} role="alert">{error}</div> : null}
        {!completed && stripePromise && elementsOptions ? <Elements stripe={stripePromise} options={elementsOptions}><PaymentForm session={session} /></Elements> : null}
        <footer>Powered by <strong>ORBIT</strong> · Payments secured by Stripe</footer>
      </div>
    </section>
  </main>;
}
