import { NextResponse } from "next/server";
import { getStripeClient, getStripeConfiguration } from "@/stripe/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const mode = process.env.STRIPE_MODE === "live" ? "live" : "test";
  const paymentMethodConfigurationConfigured = /^pmc_[A-Za-z0-9]+$/.test(process.env.STRIPE_PAYMENT_METHOD_CONFIGURATION_ID ?? "");
  const paymentsWebhookConfigured = Boolean(process.env.STRIPE_PAYMENTS_WEBHOOK_SECRET);
  if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ configured: false, mode, reachable: false, paymentMethodConfigurationConfigured, paymentsWebhookConfigured, checkoutReady: false }, { headers: { "Cache-Control": "no-store" } });
  try {
    const configuration = getStripeConfiguration();
    const stripe = getStripeClient();
    // The SDK represents the platform account with a null account id.
    await stripe.accounts.retrieve(null);
    return NextResponse.json({ configured: configuration.configured, mode: configuration.mode, reachable: true, paymentMethodConfigurationConfigured, paymentsWebhookConfigured, checkoutReady: paymentMethodConfigurationConfigured && paymentsWebhookConfigured }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ configured: true, mode, reachable: false, paymentMethodConfigurationConfigured, paymentsWebhookConfigured, checkoutReady: false }, { headers: { "Cache-Control": "no-store" } });
  }
}
