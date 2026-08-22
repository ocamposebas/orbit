import { NextResponse, type NextRequest } from "next/server";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, requireMerchantAccess } from "@/sentinel/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  try {
    const { merchantId } = await params;
    const { organization } = await requireMerchantAccess(request, merchantId);
    const merchant = await getDatabase().merchant.findFirst({ where: { id: merchantId, organizationId: organization.id }, include: { sites: true, scans: { orderBy: { createdAt: "desc" }, take: 20 }, healthScores: { orderBy: { createdAt: "desc" }, take: 12, include: { components: true } }, findings: { orderBy: [{ severity: "asc" }, { lastDetectedAt: "desc" }], take: 100, include: { evidence: { orderBy: { createdAt: "desc" }, take: 8 } } }, products: { orderBy: { lastSeenAt: "desc" }, take: 100, include: { snapshots: { orderBy: { createdAt: "desc" }, take: 1 } } }, policies: true, stripeConnect: { select: { id: true, stripeAccountId: true, stripeEnvironment: true, accountApiVersion: true, displayStatus: true, cardPaymentsStatus: true, payoutsStatus: true, requirementsCurrentlyDue: true, requirementsEventuallyDue: true, requirementsPastDue: true, requirementsPendingVerification: true, futureRequirements: true, statusDetails: true, disabledReason: true, onboardingStartedAt: true, onboardingCompletedAt: true, lastSyncedAt: true, createdAt: true, updatedAt: true } }, auditLogs: { orderBy: { createdAt: "desc" }, take: 100 } } });
    if (!merchant) throw new HttpError(404, "Merchant not found");
    return NextResponse.json({ merchant });
  } catch (error) { return apiError(error); }
}
