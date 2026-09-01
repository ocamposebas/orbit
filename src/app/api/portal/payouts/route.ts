import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/sentinel/db";
import { requestSession } from "@/sentinel/auth/session";
import { apiError, HttpError, portalMerchantScope, validateMutationOrigin } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { portalActivationEligibility } from "@/merchant-portal/eligibility";
import { getStripeClient } from "@/stripe/client";
import { childLogger } from "@/sentinel/logger";
import { requireTwoFactorCode } from "@/sentinel/auth/two-factor";

const log = childLogger({ component: "orbit-payment-transfers" });

const requestSchema = z.object({
  merchantId: z.string().min(1),
  amountMinor: z.number().int().positive().max(999_999_999),
  currency: z.string().trim().length(3).transform((value) => value.toLowerCase()),
  idempotencyKey: z.string().uuid(),
  twoFactorCode: z.string().trim().regex(/^\d{6}$/),
}).strict();

function payoutError(error: unknown): unknown {
  if (error instanceof HttpError) return error;
  if (error instanceof z.ZodError) return error;
  const value = error as { code?: string; type?: string; statusCode?: number };
  if (value.code === "balance_insufficient") return new HttpError(409, "Your available balance changed. Refresh and try a lower amount.");
  if (["payouts_not_allowed", "account_invalid", "bank_account_unverified"].includes(value.code ?? "")) return new HttpError(409, "On-demand transfers are not enabled for this ORBIT Payment account.");
  if (value.code === "resource_missing") return new HttpError(409, "A verified bank account is required before you can transfer balance.");
  if (value.type === "StripePermissionError" || value.statusCode === 403) return new HttpError(503, "ORBIT Payment needs Payouts write access before transfers can be created.");
  if (value.type === "StripeAuthenticationError" || value.statusCode === 401) return new HttpError(503, "ORBIT Payment is temporarily unavailable. Contact your administrator.");
  if (value.type === "StripeIdempotencyError") return new HttpError(409, "This transfer request conflicts with a previous attempt. Start a new transfer.");
  return new HttpError(502, "ORBIT Payment could not create this transfer. No duplicate transfer was created; try again shortly.");
}

export async function POST(request: NextRequest) {
  try {
    validateMutationOrigin(request);
    const session = await requestSession(request);
    if (!session) throw new HttpError(401, "Authentication is required");
    await enforceRateLimit(request, "portal-payout-create", 5, session.user.id);
    const input = requestSchema.parse(await request.json());
    await requireTwoFactorCode(session.user.id, input.twoFactorCode);
    const db = getDatabase();
    const merchant = await db.merchant.findFirst({
      where: { id: input.merchantId, ...portalMerchantScope(session) },
      select: {
        id: true, organizationId: true, businessName: true, portalEnabled: true,
        agreement: { select: { status: true } },
        stripeConnect: { select: { stripeAccountId: true, displayStatus: true, cardPaymentsStatus: true, payoutsStatus: true } },
        accessGrants: { where: { userId: session.user.id }, select: { canInitiatePayouts: true } },
      },
    });
    if (!merchant) throw new HttpError(404, "Brand not found");
    const privileged = ["OWNER", "ADMIN"].includes(session.role);
    if (!privileged && !merchant.accessGrants[0]?.canInitiatePayouts) throw new HttpError(403, "Your ORBIT administrator has not enabled transfers for this brand.");
    const eligibility = portalActivationEligibility({
      agreementStatus: merchant.agreement?.status,
      stripeDisplayStatus: merchant.stripeConnect?.displayStatus,
      cardPaymentsStatus: merchant.stripeConnect?.cardPaymentsStatus,
      payoutsStatus: merchant.stripeConnect?.payoutsStatus,
    });
    if (!merchant.stripeConnect || (!privileged && (!merchant.portalEnabled || !eligibility.eligible))) throw new HttpError(409, "ORBIT Payment transfers are not active for this brand.");
    if (merchant.stripeConnect.payoutsStatus?.toLowerCase() !== "active") throw new HttpError(409, "ORBIT Payment transfers are not active for this brand.");

    const stripe = getStripeClient();
    const options = { stripeContext: merchant.stripeConnect.stripeAccountId };
    const [balance, settings] = await Promise.all([
      stripe.balance.retrieve({}, options),
      stripe.balanceSettings.retrieve({}, options),
    ]);
    if (settings.payments.payouts?.schedule?.interval !== "manual") throw new HttpError(409, "On-demand transfers must be enabled by an ORBIT administrator before money can be moved.");
    const available = balance.available.find((item) => item.currency.toLowerCase() === input.currency)?.amount ?? 0;
    if (input.amountMinor > available) throw new HttpError(409, "The transfer amount is greater than your available balance. Refresh and try again.");

    const payout = await stripe.payouts.create({
      amount: input.amountMinor,
      currency: input.currency,
      method: "standard",
      description: `ORBIT Payment transfer · ${merchant.businessName}`.slice(0, 255),
      statement_descriptor: "ORBIT PAYMENT",
      metadata: { merchantId: merchant.id, requestedByUserId: session.user.id, channel: "orbit_merchant_portal" },
    }, { ...options, idempotencyKey: `orbit-payout-${merchant.id}-${input.idempotencyKey}` });

    await db.auditLog.create({ data: {
      organizationId: merchant.organizationId,
      actorId: session.user.id,
      merchantId: merchant.id,
      action: "orbit_payment.transfer_created",
      targetType: "Payout",
      targetId: payout.id,
      metadata: { amountMinor: payout.amount, currency: payout.currency, status: payout.status, method: payout.method },
    } }).catch((error) => { log.error({ merchantId: merchant.id, payoutId: payout.id, error }, "Transfer created but audit logging failed"); });

    return NextResponse.json({ transfer: { id: payout.id, amountMinor: payout.amount, currency: payout.currency, status: payout.status, arrivalDate: payout.arrival_date } }, { status: 201, headers: { "Cache-Control": "no-store, private" } });
  } catch (error) { return apiError(payoutError(error)); }
}

export async function PATCH(request: NextRequest) {
  try {
    validateMutationOrigin(request);
    const session = await requestSession(request);
    if (!session) throw new HttpError(401, "Authentication is required");
    if (!["OWNER", "ADMIN"].includes(session.role)) throw new HttpError(403, "Only an ORBIT administrator can enable on-demand transfers.");
    await enforceRateLimit(request, "portal-payout-schedule", 5, session.user.id);
    const input = z.object({ merchantId: z.string().min(1), twoFactorCode: z.string().trim().regex(/^\d{6}$/) }).strict().parse(await request.json());
    await requireTwoFactorCode(session.user.id, input.twoFactorCode);
    const db = getDatabase();
    const merchant = await db.merchant.findFirst({
      where: { id: input.merchantId, ...portalMerchantScope(session) },
      select: { id: true, organizationId: true, stripeConnect: { select: { stripeAccountId: true, payoutsStatus: true } } },
    });
    if (!merchant?.stripeConnect) throw new HttpError(404, "ORBIT Payment account not found");
    if (merchant.stripeConnect.payoutsStatus?.toLowerCase() !== "active") throw new HttpError(409, "ORBIT Payment transfers are not active for this brand.");
    const settings = await getStripeClient().balanceSettings.update({ payments: { payouts: { schedule: { interval: "manual" } } } }, { stripeContext: merchant.stripeConnect.stripeAccountId });
    await db.auditLog.create({ data: {
      organizationId: merchant.organizationId, actorId: session.user.id, merchantId: merchant.id,
      action: "orbit_payment.on_demand_transfers_enabled", targetType: "Merchant", targetId: merchant.id,
      metadata: { payoutSchedule: settings.payments.payouts?.schedule?.interval ?? "manual" },
    } });
    return NextResponse.json({ enabled: settings.payments.payouts?.schedule?.interval === "manual" }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) { return apiError(payoutError(error)); }
}
