import { NextResponse, type NextRequest } from "next/server";
import { renderAiScanReportPdf } from "@/ai-scanner/report";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, merchantScope } from "@/sentinel/http";
import { requestSession } from "@/sentinel/auth/session";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  try {
    await enforceRateLimit(request, "ai-scanner-report", 20);
    const session = await requestSession(request);
    if (!session) throw new HttpError(401, "Authentication is required");
    const { scanId } = await params;
    const scan = await getDatabase().aiScan.findFirst({ where: { id: scanId, merchant: merchantScope(session) }, select: { id: true, merchant: { select: { slug: true } } } });
    if (!scan) throw new HttpError(404, "AI scan not found");
    const pdf = await renderAiScanReportPdf(scanId);
    return new NextResponse(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${scan.merchant.slug}-ai-scanner-${scanId.slice(-8)}.pdf"`, "cache-control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
