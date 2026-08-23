import { NextResponse, type NextRequest } from "next/server";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, requireMerchantAccess } from "@/sentinel/http";
import { childLogger } from "@/sentinel/logger";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { updateMerchantLegalCountrySchema } from "@/sentinel/services/merchants";

export const runtime = "nodejs";
const log = childLogger({ component: "merchant-api" });

function isMissingOptionalStripeSchema(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && ["P2021", "P2022"].includes(String(error.code));
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  try {
    const { merchantId } = await params;
    const { organization } = await requireMerchantAccess(request, merchantId);
    const db = getDatabase();
    const merchant = await db.merchant.findFirst({ where: { id: merchantId, organizationId: organization.id }, include: { sites: true, scans: { orderBy: { createdAt: "desc" }, take: 20 }, healthScores: { orderBy: { createdAt: "desc" }, take: 12, include: { components: true } }, findings: { orderBy: [{ severity: "asc" }, { lastDetectedAt: "desc" }], take: 100, include: { evidence: { orderBy: { createdAt: "desc" }, take: 8 } } }, products: { orderBy: { lastSeenAt: "desc" }, take: 100, include: { snapshots: { orderBy: { createdAt: "desc" }, take: 1 } } }, policies: true, auditLogs: { orderBy: { createdAt: "desc" }, take: 100 } } });
    if (!merchant) throw new HttpError(404, "Merchant not found");
    let stripeConnect = null;
    let stripeConnectAvailable = true;
    try {
      stripeConnect = await db.stripeConnectIntegration.findUnique({ where: { merchantId }, select: { id: true, stripeAccountId: true, stripeEnvironment: true, accountApiVersion: true, displayStatus: true, cardPaymentsStatus: true, payoutsStatus: true, requirementsCurrentlyDue: true, requirementsEventuallyDue: true, requirementsPastDue: true, requirementsPendingVerification: true, futureRequirements: true, statusDetails: true, disabledReason: true, onboardingStartedAt: true, onboardingCompletedAt: true, lastSyncedAt: true, createdAt: true, updatedAt: true } });
    } catch (error) {
      if (!isMissingOptionalStripeSchema(error)) throw error;
      stripeConnectAvailable = false;
      log.warn({ merchantId, errorCode: String((error as { code: unknown }).code) }, "Stripe Connect schema is not deployed; serving merchant without the optional integration");
    }
    return NextResponse.json({ merchant: { ...merchant, stripeConnect, stripeConnectAvailable } });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  try {
    await enforceRateLimit(request, "merchant-update", 30);
    const { merchantId } = await params;
    const { session, organization, merchant } = await requireMerchantAccess(request, merchantId, { allowedRoles: ["OWNER", "ADMIN"], mutation: true });
    const input = updateMerchantLegalCountrySchema.parse(await request.json());
    const db = getDatabase();
    const integration = await db.stripeConnectIntegration.findUnique({ where: { merchantId }, select: { id: true } });
    if (integration && merchant.legalCountry && input.legalCountry !== merchant.legalCountry) {
      throw new HttpError(409, "The legal business country cannot be changed after Stripe is connected");
    }
    const updated = await db.merchant.update({ where: { id: merchantId }, data: { legalCountry: input.legalCountry }, select: { id: true, legalCountry: true } });
    await db.auditLog.create({ data: {
      organizationId: organization.id,
      merchantId,
      actorId: session.user.id,
      action: "MERCHANT_LEGAL_COUNTRY_UPDATED",
      targetType: "Merchant",
      targetId: merchantId,
      metadata: { previousLegalCountry: merchant.legalCountry, legalCountry: input.legalCountry },
    } });
    return NextResponse.json({ merchant: updated });
  } catch (error) { return apiError(error); }
}
