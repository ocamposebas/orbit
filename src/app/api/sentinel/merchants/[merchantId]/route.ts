import { NextResponse, type NextRequest } from "next/server";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, requireOrganization } from "@/sentinel/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  try {
    const organization = await requireOrganization(request);
    const { merchantId } = await params;
    const merchant = await getDatabase().merchant.findFirst({ where: { id: merchantId, organizationId: organization.id }, include: { sites: true, scans: { orderBy: { createdAt: "desc" }, take: 20 }, healthScores: { orderBy: { createdAt: "desc" }, take: 12, include: { components: true } }, findings: { orderBy: [{ severity: "asc" }, { lastDetectedAt: "desc" }], take: 100, include: { evidence: { orderBy: { createdAt: "desc" }, take: 3 } } }, products: { orderBy: { lastSeenAt: "desc" }, take: 100 }, policies: true, auditLogs: { orderBy: { createdAt: "desc" }, take: 100 } } });
    if (!merchant) throw new HttpError(404, "Merchant not found");
    return NextResponse.json({ merchant });
  } catch (error) { return apiError(error); }
}
