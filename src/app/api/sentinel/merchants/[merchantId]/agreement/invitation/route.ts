import { NextResponse, type NextRequest } from "next/server";
import { rotateInvitation } from "@/contracts/service";
import { apiError, requireMerchantAccess } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { getDatabase } from "@/sentinel/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  try {
    await enforceRateLimit(request, "agreement-invitation-rotate", 10);
    const { merchantId } = await params;
    const { session, organization } = await requireMerchantAccess(request, merchantId, { allowedRoles: ["OWNER", "ADMIN", "ANALYST"], mutation: true });
    const invitation = await rotateInvitation(merchantId);
    const agreement = await getDatabase().merchantAgreement.findUnique({ where: { merchantId }, select: { id: true } });
    if (agreement) await getDatabase().auditLog.create({ data: { organizationId: organization.id, merchantId, actorId: session.user.id, action: "agreement.invitation_rotated", targetType: "MerchantAgreement", targetId: agreement.id, metadata: { expiresAt: invitation.expiresAt } } });
    return NextResponse.json({ invitationUrl: invitation.url, invitationExpiresAt: invitation.expiresAt });
  } catch (error) { return apiError(error); }
}
