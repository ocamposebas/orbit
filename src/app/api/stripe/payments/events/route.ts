import { NextResponse, type NextRequest } from "next/server";
import { handleStripePaymentEvent } from "@/payments/webhook";
import { getServerEnv } from "@/sentinel/config";
import { childLogger } from "@/sentinel/logger";
import { getStripeClient } from "@/stripe/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = childLogger({ component: "stripe-payment-webhook" });

export async function POST(request: NextRequest) {
  const env = getServerEnv();
  if (!env.STRIPE_PAYMENTS_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe payment webhook is not configured" }, { status: 503 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 });

  let event;
  try {
    event = await getStripeClient().webhooks.constructEventAsync(
      await request.text(),
      signature,
      env.STRIPE_PAYMENTS_WEBHOOK_SECRET,
    );
  } catch {
    log.warn({ reason: "invalid_signature" }, "Rejected Stripe payment webhook");
    return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  try {
    const result = await handleStripePaymentEvent(event);
    return NextResponse.json({ received: true, ...result });
  } catch {
    return NextResponse.json({ error: "Stripe payment event processing failed" }, { status: 500 });
  }
}
