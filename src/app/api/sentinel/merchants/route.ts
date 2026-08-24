import { NextResponse, type NextRequest } from "next/server";
import { getDatabase } from "@/sentinel/db";
import { apiError, merchantScope, requireRole } from "@/sentinel/http";
import { requestSession } from "@/sentinel/auth/session";
import { createSelfServeMerchantInvitation } from "@/sentinel/services/merchants";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { agreementAdminState, invitationUrl } from "@/contracts/service";
import { childLogger } from "@/sentinel/logger";

export const runtime = "nodejs";
const log = childLogger({ component: "merchants-api" });

function isMissingDatabaseColumn(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && String(error.code) === "P2022";
}

export async function GET(request: NextRequest) {
  try {
    const session = await requestSession(request);
    if (!session) return NextResponse.json({ error: "Authentication is required" }, { status: 401 });
    const db = getDatabase();
    try {
      const merchants = await db.merchant.findMany({ where: merchantScope(session), orderBy: { updatedAt: "desc" }, include: { agreement: { select: { status: true, invitationExpiresAt: true, invitationIssuedAt: true, informationCertifiedAt: true, contractIssuedAt: true, signedUploadedAt: true, signedOriginalName: true, signedSizeBytes: true, lockedAt: true, termsVersion: true } }, sites: { where: { active: true }, take: 1 }, healthScores: { orderBy: { createdAt: "desc" }, take: 1 }, scans: { orderBy: { createdAt: "desc" }, take: 1 }, _count: { select: { findings: { where: { status: { in: ["OPEN", "NEEDS_REVIEW", "CONFIRMED"] } } } } } } });
      return NextResponse.json({ merchants: merchants.map((merchant) => ({ ...merchant, agreement: agreementAdminState(merchant.agreement) })) });
    } catch (error) {
      if (!isMissingDatabaseColumn(error)) throw error;
      log.warn({ errorCode: "P2022" }, "Agreement invitation timestamp is not deployed; serving the merchant list in compatibility mode");
      const merchants = await db.merchant.findMany({ where: merchantScope(session), orderBy: { updatedAt: "desc" }, include: { agreement: { select: { status: true, invitationExpiresAt: true, informationCertifiedAt: true, contractIssuedAt: true, signedUploadedAt: true, signedOriginalName: true, signedSizeBytes: true, lockedAt: true, termsVersion: true } }, sites: { where: { active: true }, take: 1 }, healthScores: { orderBy: { createdAt: "desc" }, take: 1 }, scans: { orderBy: { createdAt: "desc" }, take: 1 }, _count: { select: { findings: { where: { status: { in: ["OPEN", "NEEDS_REVIEW", "CONFIRMED"] } } } } } } });
      return NextResponse.json({ merchants: merchants.map((merchant) => ({ ...merchant, agreement: agreementAdminState(merchant.agreement ? { ...merchant.agreement, invitationIssuedAt: null } : null) })) });
    }
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
