import { NextResponse } from "next/server";
import { getStripeClient, getStripeConfiguration } from "@/stripe/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const mode = process.env.STRIPE_MODE === "live" ? "live" : "test";
  if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ configured: false, mode, reachable: false }, { headers: { "Cache-Control": "no-store" } });
  try {
    const configuration = getStripeConfiguration();
    const stripe = getStripeClient();
    // The SDK represents the platform account with a null account id.
    await stripe.accounts.retrieve(null);
    return NextResponse.json({ configured: configuration.configured, mode: configuration.mode, reachable: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ configured: true, mode, reachable: false }, { headers: { "Cache-Control": "no-store" } });
  }
}
