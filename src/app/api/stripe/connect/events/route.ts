import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/sentinel/config";
import { getDatabase } from "@/sentinel/db";
import { childLogger } from "@/sentinel/logger";
import { expectedLivemode, getStripeClient, getStripeConfiguration } from "@/stripe/client";
import { auditStripeConnectError, syncStripeConnectAccount } from "@/stripe/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = childLogger({ component: "stripe-connect-events" });
const v2Types = new Set([
  "v2.core.account[requirements].updated",
  "v2.core.account[future_requirements].updated",
  "v2.core.account[configuration.merchant].capability_status_updated",
  "v2.core.account[configuration.merchant].updated",
  "v2.core.account.updated",
]);
const v1Types = new Set(["account.updated"]);

type VerifiedEvent = { id: string; type: string; livemode: boolean; accountId?: string };

async function verifyEvent(rawBody: string, signature: string, secret: string): Promise<VerifiedEvent> {
  const stripe = getStripeClient();
  try {
    const notification = await stripe.parseEventNotificationAsync(rawBody, signature, secret);
    const related = "related_object" in notification ? notification.related_object : undefined;
    return { id: notification.id, type: notification.type, livemode: notification.livemode, accountId: related?.type === "v2.core.account" ? related.id : undefined };
  } catch (v2Error) {
    try {
      const event = await stripe.webhooks.constructEventAsync(rawBody, signature, secret);
      const object = event.data.object as { id?: string; object?: string };
      return { id: event.id, type: event.type, livemode: event.livemode, accountId: object.object === "account" && object.id?.startsWith("acct_") ? object.id : event.account ?? undefined };
    } catch {
      throw v2Error;
    }
  }
}

export async function POST(request: NextRequest) {
  const env = getServerEnv();
  if (!env.STRIPE_CONNECT_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) return NextResponse.json({ error: "Stripe event endpoint is not configured" }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 });
  const rawBody = await request.text();
  let event: VerifiedEvent;
  try {
    event = await verifyEvent(rawBody, signature, env.STRIPE_CONNECT_WEBHOOK_SECRET);
  } catch {
    log.warn({ reason: "invalid_signature" }, "Rejected Stripe event");
    return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  const db = getDatabase();
  const relevant = v2Types.has(event.type) || v1Types.has(event.type);
  let eventRecord;
  try {
    eventRecord = await db.stripeConnectEvent.create({ data: { stripeEventId: event.id, stripeAccountId: event.accountId, type: event.type, livemode: event.livemode } });
  } catch {
    const duplicate = await db.stripeConnectEvent.findUnique({ where: { stripeEventId: event.id }, select: { id: true } });
    if (duplicate) return NextResponse.json({ received: true, duplicate: true });
    throw new Error("Unable to record Stripe event");
  }

  if (event.livemode !== expectedLivemode(getStripeConfiguration().mode)) {
    await db.stripeConnectEvent.update({ where: { id: eventRecord.id }, data: { status: "IGNORED", processedAt: new Date(), errorCode: "environment_mismatch" } });
    log.warn({ stripeEventId: event.id, type: event.type }, "Ignored Stripe event from another environment");
    return NextResponse.json({ received: true, ignored: true });
  }
  if (!relevant) {
    await db.stripeConnectEvent.update({ where: { id: eventRecord.id }, data: { status: "IGNORED", processedAt: new Date(), errorCode: "event_type_not_monitored" } });
    return NextResponse.json({ received: true, ignored: true });
  }
  if (!event.accountId?.startsWith("acct_")) {
    await db.stripeConnectEvent.update({ where: { id: eventRecord.id }, data: { status: "IGNORED", processedAt: new Date(), errorCode: "missing_account_id" } });
    return NextResponse.json({ received: true, ignored: true });
  }
  const integration = await db.stripeConnectIntegration.findUnique({ where: { stripeAccountId: event.accountId }, select: { id: true, merchantId: true } });
  if (!integration) {
    await db.stripeConnectEvent.update({ where: { id: eventRecord.id }, data: { status: "IGNORED", processedAt: new Date(), errorCode: "unknown_account" } });
    log.warn({ stripeEventId: event.id, type: event.type, stripeAccountId: event.accountId }, "Ignored Stripe event for unknown account");
    return NextResponse.json({ received: true, ignored: true });
  }
  await db.stripeConnectEvent.update({ where: { id: eventRecord.id }, data: { integrationId: integration.id } });
  try {
    await syncStripeConnectAccount(integration.merchantId, { auditAction: "STRIPE_REQUIREMENTS_UPDATED", eventId: event.id });
    await db.stripeConnectEvent.update({ where: { id: eventRecord.id }, data: { status: "PROCESSED", processedAt: new Date() } });
    log.info({ stripeEventId: event.id, type: event.type, stripeAccountId: event.accountId }, "Synchronized Stripe connected account");
    return NextResponse.json({ received: true });
  } catch (error) {
    const code = error instanceof Error ? error.name.slice(0, 120) : "sync_failed";
    await db.stripeConnectEvent.update({ where: { id: eventRecord.id }, data: { status: "FAILED", processedAt: new Date(), errorCode: code } });
    await auditStripeConnectError(integration.merchantId, undefined, "event_sync", error);
    log.error({ stripeEventId: event.id, type: event.type, stripeAccountId: event.accountId, errorCode: code }, "Stripe account synchronization failed");
    return NextResponse.json({ error: "Stripe account synchronization failed" }, { status: 500 });
  }
}
