import { NextResponse, type NextRequest } from "next/server";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, merchantScope } from "@/sentinel/http";
import { requestSession } from "@/sentinel/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  try {
    const session = await requestSession(request);
    if (!session) return NextResponse.json({ error: "Authentication is required" }, { status: 401 });
    const { scanId } = await params;
    const scan = await getDatabase().scan.findFirst({ where: { id: scanId, merchant: merchantScope(session) }, include: { changes: { orderBy: { createdAt: "desc" }, take: 25, include: { scanPage: { select: { url: true, title: true } } } }, healthScores: { include: { components: true } } } });
    if (!scan) throw new HttpError(404, "Scan not found");
    return NextResponse.json({ scan }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
