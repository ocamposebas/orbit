import { NextResponse, type NextRequest } from "next/server";
import { getDatabase } from "@/sentinel/db";
import { apiError, merchantScope, requireRole } from "@/sentinel/http";
import { requestSession } from "@/sentinel/auth/session";
import { createMerchant, createMerchantSchema } from "@/sentinel/services/merchants";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await requestSession(request);
    if (!session) return NextResponse.json({ error: "Authentication is required" }, { status: 401 });
    const merchants = await getDatabase().merchant.findMany({ where: merchantScope(session), orderBy: { updatedAt: "desc" }, include: { sites: { where: { active: true }, take: 1 }, healthScores: { orderBy: { createdAt: "desc" }, take: 1 }, scans: { orderBy: { createdAt: "desc" }, take: 1 }, _count: { select: { findings: { where: { status: { in: ["OPEN", "NEEDS_REVIEW", "CONFIRMED"] } } } } } } });
    return NextResponse.json({ merchants });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit(request, "merchant-create", 10);
    const session = await requestSession(request);
    const organization = await requireRole(request, ["OWNER", "ADMIN", "ANALYST"]);
    const input = createMerchantSchema.omit({ organizationId: true }).parse(await request.json());
    if (input.legalCountry && !["OWNER", "ADMIN"].includes(session?.role ?? "")) {
      return NextResponse.json({ error: "Only an organization owner or admin can set the legal business country" }, { status: 403 });
    }
    const merchant = await createMerchant({ ...input, organizationId: organization.id });
    return NextResponse.json({ merchant }, { status: 201 });
  } catch (error) { return apiError(error); }
}
