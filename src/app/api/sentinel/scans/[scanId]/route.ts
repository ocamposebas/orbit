import { NextResponse, type NextRequest } from "next/server";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, requireOrganization } from "@/sentinel/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  try {
    const organization = await requireOrganization(request);
    const { scanId } = await params;
    const scan = await getDatabase().scan.findFirst({ where: { id: scanId, merchant: { organizationId: organization.id } }, include: { changes: { orderBy: { createdAt: "desc" }, take: 25, include: { scanPage: { select: { url: true, title: true } } } }, healthScores: { include: { components: true } } } });
    if (!scan) throw new HttpError(404, "Scan not found");
    return NextResponse.json({ scan }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
