import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eventCreate: vi.fn(),
  eventFind: vi.fn(),
  eventUpdate: vi.fn(),
  integrationFind: vi.fn(),
  sync: vi.fn(),
}));

vi.mock("@/sentinel/db", () => ({ getDatabase: () => ({
  stripeConnectEvent: { create: mocks.eventCreate, findUnique: mocks.eventFind, update: mocks.eventUpdate },
  stripeConnectIntegration: { findUnique: mocks.integrationFind },
}) }));
vi.mock("@/stripe/service", () => ({ syncStripeConnectAccount: mocks.sync, auditStripeConnectError: vi.fn() }));

process.env.STRIPE_SECRET_KEY = "sk_test_example";
process.env.STRIPE_MODE = "test";
process.env.STRIPE_CONNECT_ACCOUNT_API = "v2";
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_orbit_test";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function payload(id = "evt_orbit_1", accountId = "acct_unknown") {
  return JSON.stringify({
    id, object: "event", api_version: "2026-07-29.dahlia", created: 1_787_340_000,
    data: { object: { id: accountId, object: "account", livemode: false } },
    livemode: false, pending_webhooks: 1, request: null, type: "account.updated",
  });
}

function v2Payload(id = "evt_v2_orbit", accountId = "acct_v2_unknown") {
  return JSON.stringify({
    id, object: "v2.core.event", created: "2026-08-22T20:00:00.000Z", livemode: false,
    type: "v2.core.account[requirements].updated",
    related_object: { id: accountId, type: "v2.core.account", url: `/v2/core/accounts/${accountId}` },
  });
}

function signedRequest(body: string, signature?: string) {
  const header = signature ?? stripe.webhooks.generateTestHeaderString({ payload: body, secret: process.env.STRIPE_CONNECT_WEBHOOK_SECRET! });
  return new Request("http://localhost/api/stripe/connect/events", { method: "POST", body, headers: { "content-type": "application/json", "stripe-signature": header } });
}

describe("Stripe Connect event security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eventUpdate.mockResolvedValue({});
  });

  it("rejects an invalid Stripe signature before touching the database", async () => {
    const { POST } = await import("@/app/api/stripe/connect/events/route");
    const response = await POST(signedRequest(payload(), "t=123,v1=invalid") as never);
    expect(response.status).toBe(400);
    expect(mocks.eventCreate).not.toHaveBeenCalled();
  });

  it("acknowledges a duplicate event without synchronizing twice", async () => {
    mocks.eventCreate.mockRejectedValueOnce(new Error("unique constraint"));
    mocks.eventFind.mockResolvedValueOnce({ id: "stored_event" });
    const { POST } = await import("@/app/api/stripe/connect/events/route");
    const response = await POST(signedRequest(payload("evt_duplicate")) as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ received: true, duplicate: true });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("does not attach an unknown acct_* to any merchant", async () => {
    mocks.eventCreate.mockResolvedValueOnce({ id: "event_row" });
    mocks.integrationFind.mockResolvedValueOnce(null);
    const { POST } = await import("@/app/api/stripe/connect/events/route");
    const response = await POST(signedRequest(payload("evt_unknown", "acct_not_in_orbit")) as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ received: true, ignored: true });
    expect(mocks.integrationFind).toHaveBeenCalledWith({ where: { stripeAccountId: "acct_not_in_orbit" }, select: { id: true, merchantId: true } });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("verifies the Accounts v2 thin requirements event and resolves only its related acct_*", async () => {
    mocks.eventCreate.mockResolvedValueOnce({ id: "v2_event_row" });
    mocks.integrationFind.mockResolvedValueOnce(null);
    const { POST } = await import("@/app/api/stripe/connect/events/route");
    const response = await POST(signedRequest(v2Payload()) as never);
    expect(response.status).toBe(200);
    expect(mocks.eventCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ stripeEventId: "evt_v2_orbit", stripeAccountId: "acct_v2_unknown", type: "v2.core.account[requirements].updated" }) });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("retrieves authoritative state for a known v2 requirements event", async () => {
    mocks.eventCreate.mockResolvedValueOnce({ id: "known_event_row" });
    mocks.integrationFind.mockResolvedValueOnce({ id: "integration_1", merchantId: "merchant_1" });
    mocks.sync.mockResolvedValueOnce({ displayStatus: "IN_REVIEW" });
    const { POST } = await import("@/app/api/stripe/connect/events/route");
    const response = await POST(signedRequest(v2Payload("evt_known", "acct_known")) as never);
    expect(response.status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith("merchant_1", { auditAction: "STRIPE_REQUIREMENTS_UPDATED", eventId: "evt_known" });
    expect(mocks.eventUpdate).toHaveBeenCalledWith({ where: { id: "known_event_row" }, data: { status: "PROCESSED", processedAt: expect.any(Date) } });
  });
});
