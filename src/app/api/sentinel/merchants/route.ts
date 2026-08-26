import { NextResponse, type NextRequest } from "next/server";
import { getDatabase } from "@/sentinel/db";
import { apiError, merchantScope, requireRole } from "@/sentinel/http";
import { requestSession } from "@/sentinel/auth/session";
import { createSelfServeMerchantInvitation } from "@/sentinel/services/merchants";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { agreementAdminState, invitationUrl } from "@/contracts/service";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const session = await requestSession(request);
    if (!session) return NextResponse.json({ error: "Authentication is required" }, { status: 401 });
    const db = getDatabase();
    const merchants = await db.merchant.findMany({ where: merchantScope(session), orderBy: { updatedAt: "desc" }, include: { agreement: { select: { status: true, invitationExpiresAt: true, invitationIssuedAt: true, informationCertifiedAt: true, contractIssuedAt: true, signedUploadedAt: true, signedOriginalName: true, signedSizeBytes: true, lockedAt: true, termsVersion: true } }, sites: { where: { active: true }, take: 1 }, aiScans: { orderBy: { createdAt: "desc" }, take: 1 }, _count: { select: { aiFindings: { where: { status: { in: ["OPEN", "NEEDS_REVIEW", "CONFIRMED"] } } } } } } });
    return NextResponse.json({ merchants: merchants.map(({ aiScans, _count, ...merchant }) => ({ ...merchant, agreement: agreementAdminState(merchant.agreement), healthScores: aiScans[0]?.score === null || aiScans[0]?.score === undefined ? [] : [{ total: aiScans[0].score }], scans: aiScans, _count: { findings: _count.aiFindings } })) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit(request, "merchant-self-serve-invitation", 30);
    const organization = await requireRole(request, ["OWNER", "ADMIN", "ANALYST"]);
    const created = await createSelfServeMerchantInvitation(organization.id);
    return NextResponse.json({ merchant: created.merchant, invitationUrl: invitationUrl(created.invitationToken), invitationExpiresAt: created.invitationExpiresAt }, { status: 201 });
  } catch (error) { return apiError(error); }
}
