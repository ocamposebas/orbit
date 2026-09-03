"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Elements, ExpressCheckoutElement, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type StripeElementsOptions } from "@stripe/stripe-js";
import { Check, CircleCheck, LockKeyhole, Orbit, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import type { PublicOrbitPaymentLink } from "@/payment-links/service";
import styles from "./orbit-payment-link-checkout.module.css";

type Configuration = { clientSecret: string; publishableKey: string; paymentPublicId: string; connectedAccountId: string | null };

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amountMinor / 100);
}

function PaymentForm({ link, paymentPublicId, onConfirming }: { link: PublicOrbitPaymentLink; paymentPublicId: string; onConfirming: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const confirm = useCallback(async () => {
    if (!stripe || !elements || busy) return;
    setBusy(true); setMessage(null);
    const returnUrl = `${window.location.origin}/pay/orbit/${encodeURIComponent(link.publicId)}?payment=${encodeURIComponent(paymentPublicId)}`;
    const result = await stripe.confirmPayment({ elements, confirmParams: { return_url: returnUrl }, redirect: "if_required" });
    if (result.error) {
      setMessage(result.error.message ?? "We could not complete the payment. Review your details and try again.");
      setBusy(false); return;
    }
    window.history.replaceState(null, "", `?payment=${encodeURIComponent(paymentPublicId)}`);
    onConfirming();
  }, [busy, elements, link.publicId, onConfirming, paymentPublicId, stripe]);

  return <>
    <div className={styles.express}><span>Apple Pay, Google Pay or Link</span><ExpressCheckoutElement onConfirm={() => void confirm()} options={{
      business: { name: link.accountName },
      buttonHeight: 48,
      layout: { maxColumns: 3, maxRows: 1, overflow: "auto" },
      paymentMethodOrder: ["apple_pay", "google_pay", "link"],
      paymentMethods: { applePay: "always", googlePay: "always", link: "auto", amazonPay: "never", paypal: "never", klarna: "never" },
    }} /></div>
    <div className={styles.divider}><span>or pay by card</span></div>
    <form onSubmit={(event) => { event.preventDefault(); void confirm(); }}>
      <PaymentElement options={{
        business: { name: link.accountName },
        layout: { type: "tabs", defaultCollapsed: false },
        paymentMethodOrder: ["card", "link", "cashapp", "us_bank_account", "klarna", "affirm"],
      }} />
      {message && <div className={styles.error} role="alert">{message}</div>}
      <button className={styles.payButton} type="submit" disabled={!stripe || !elements || busy}>{busy ? <><RefreshCw size={16} className={styles.spin} />Processing securely</> : <>Pay {money(link.amountMinor, link.currency)} <span>→</span></>}</button>
    </form>
  </>;
}

function FinalState({ status, link }: { status: string; link: PublicOrbitPaymentLink }) {
  const success = status === "SUCCEEDED";
  const failed = status === "FAILED" || status === "CANCELED";
  return <div className={styles.finalState}>
    <span className={success ? styles.successIcon : styles.processingIcon}>{success ? <CircleCheck size={34} /> : failed ? <LockKeyhole size={28} /> : <RefreshCw size={28} className={styles.spin} />}</span>
    <p className={styles.kicker}>{success ? "Payment complete" : failed ? "Payment not completed" : "Secure confirmation"}</p>
    <h2>{success ? "You’re all set." : failed ? "No successful charge was recorded." : "Confirming your payment…"}</h2>
    <p>{success ? `${money(link.amountMinor, link.currency)} was paid successfully to ${link.accountName}.` : failed ? "Your payment was not completed. You can return to the checkout and try another payment method." : "ORBIT is waiting for Stripe’s signed confirmation. You can keep this page open."}</p>
    {success && <span className={styles.receiptNote}><Check size={14} /> Payment result verified by ORBIT</span>}
    {failed && <a className={styles.retryLink} href={`/pay/orbit/${encodeURIComponent(link.publicId)}`}>Return to checkout</a>}
  </div>;
}

export function OrbitPaymentLinkCheckout({ link, initialPaymentId }: { link: PublicOrbitPaymentLink; initialPaymentId: string | null }) {
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [loading, setLoading] = useState(link.available && !initialPaymentId);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(initialPaymentId ? "PROCESSING" : "");
  const paymentId = initialPaymentId ?? configuration?.paymentPublicId ?? null;

  useEffect(() => {
    if (!link.available || initialPaymentId) return;
    let active = true;
    const storageKey = `orbit:payment-link:${link.publicId}`;
    const checkoutKey = window.sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
    window.sessionStorage.setItem(storageKey, checkoutKey);
    void fetch(`/api/payment-links/${encodeURIComponent(link.publicId)}/checkout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checkoutKey }), cache: "no-store" })
      .then(async (response) => { const body = await response.json().catch(() => ({})) as Configuration & { error?: string }; if (!response.ok) throw new Error(body.error ?? "Secure checkout is temporarily unavailable."); if (active) setConfiguration(body); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Secure checkout is temporarily unavailable."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [initialPaymentId, link.available, link.publicId]);

  useEffect(() => {
    if (!paymentId || !status || ["SUCCEEDED", "FAILED", "CANCELED"].includes(status)) return;
    let active = true;
    const check = async () => {
      const response = await fetch(`/api/payment-links/${encodeURIComponent(link.publicId)}/payments/${encodeURIComponent(paymentId)}`, { cache: "no-store" });
      if (!response.ok || !active) return;
      const body = await response.json() as { status: string };
      if (active) setStatus(body.status);
    };
    void check();
    const timer = window.setInterval(() => void check(), 2_500);
    return () => { active = false; window.clearInterval(timer); };
  }, [link.publicId, paymentId, status]);

  const stripePromise = useMemo(() => configuration ? loadStripe(configuration.publishableKey, configuration.connectedAccountId ? { stripeAccount: configuration.connectedAccountId } : undefined) : null, [configuration]);
  const elementsOptions = useMemo<StripeElementsOptions | undefined>(() => configuration ? ({
    clientSecret: configuration.clientSecret,
    appearance: { theme: "night", variables: { colorPrimary: "#8b7cff", colorBackground: "#11131a", colorText: "#f5f3ff", colorDanger: "#ff7c91", borderRadius: "13px", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", spacingUnit: "4px" }, rules: { ".Input": { border: "1px solid rgba(255,255,255,.12)", boxShadow: "none", padding: "13px" }, ".Input:focus": { border: "1px solid #8b7cff", boxShadow: "0 0 0 3px rgba(139,124,255,.12)" }, ".Tab": { border: "1px solid rgba(255,255,255,.10)", boxShadow: "none" }, ".Tab--selected": { border: "1px solid rgba(139,124,255,.65)", backgroundColor: "rgba(139,124,255,.08)" } } },
  }) : undefined, [configuration]);

  return <main className={styles.shell}>
    <div className={styles.glowOne} /><div className={styles.glowTwo} /><div className={styles.grid} />
    <nav className={styles.topbar}><div className={styles.logo}><span><Orbit size={18} /></span>ORBIT</div><div className={styles.secureTop}><LockKeyhole size={13} />Secure checkout</div></nav>
    <section className={styles.checkout}>
      <aside className={styles.summary}>
        <div><span className={styles.accountBadge}><Sparkles size={13} />{link.platformOwned ? "ORBIT original" : "ORBIT Payment"}</span><p className={styles.payTo}>Payment to</p><h1>{link.accountName}</h1><p className={styles.title}>{link.title}</p>{link.description && <p className={styles.description}>{link.description}</p>}</div>
        <div className={styles.amountBlock}><span>Total due</span><strong>{money(link.amountMinor, link.currency)}</strong><small>{link.currency}</small></div>
        <div className={styles.trust}><span><ShieldCheck size={16} />Verified payment flow</span><span><LockKeyhole size={16} />Encrypted by Stripe</span><span><Check size={16} />No card data stored by ORBIT</span></div>
      </aside>
      <div className={styles.paymentPanel}>
        {!link.available ? <div className={styles.unavailable}><span><LockKeyhole size={24} /></span><p>Payment link unavailable</p><h2>{link.unavailableReason === "expired" ? "This link has expired." : "This link is no longer active."}</h2><small>Contact the person or business that shared it with you for a new payment link.</small></div> : status && paymentId ? <FinalState status={status} link={link} /> : <>
          <header><p>Complete payment</p><h2>Choose how you’d like to pay</h2><span>Available methods are selected securely for your device and region.</span></header>
          {loading && <div className={styles.loading}><RefreshCw size={20} className={styles.spin} />Preparing your secure checkout…</div>}
          {error && <div className={styles.error} role="alert">{error}</div>}
          {stripePromise && elementsOptions && configuration && <Elements stripe={stripePromise} options={elementsOptions}><PaymentForm link={link} paymentPublicId={configuration.paymentPublicId} onConfirming={() => setStatus("PROCESSING")} /></Elements>}
        </>}
        <footer>Powered by <b>ORBIT</b><i />Payments secured by Stripe</footer>
      </div>
    </section>
  </main>;
}
