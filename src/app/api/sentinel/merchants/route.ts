import { NextResponse, type NextRequest } from "next/server";
import { getDatabase } from "@/sentinel/db";
import { apiError, requireOrganization, requireRole } from "@/sentinel/http";
import { createMerchant, createMerchantSchema } from "@/sentinel/services/merchants";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const organization = await requireOrganization(request);
    const merchants = await getDatabase().merchant.findMany({ where: { organizationId: organization.id }, orderBy: { updatedAt: "desc" }, include: { sites: { where: { active: true }, take: 1 }, healthScores: { orderBy: { createdAt: "desc" }, take: 1 }, scans: { orderBy: { createdAt: "desc" }, take: 1 }, _count: { select: { findings: { where: { status: { in: ["OPEN", "NEEDS_REVIEW", "CONFIRMED"] } } } } } } });
    return NextResponse.json({ merchants });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit(request, "merchant-create", 10);
    const organization = await requireRole(request, ["OWNER", "ADMIN", "ANALYST"]);
    const input = createMerchantSchema.omit({ organizationId: true }).parse(await request.json());
    const merchant = await createMerchant({ ...input, organizationId: organization.id });
    return NextResponse.json({ merchant }, { status: 201 });
  } catch (error) { return apiError(error); }
}
