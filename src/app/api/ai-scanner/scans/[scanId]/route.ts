import { NextResponse, type NextRequest } from "next/server";
import { aiScanDetailInclude, hasAiScanResumeCheckpoint } from "@/ai-scanner/service";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, merchantScope } from "@/sentinel/http";
import { requestSession } from "@/sentinel/auth/session";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  try {
    const session = await requestSession(request);
    if (!session) throw new HttpError(401, "Authentication is required");
    const { scanId } = await params;
    const scan = await getDatabase().aiScan.findFirst({ where: { id: scanId, merchant: merchantScope(session) }, include: aiScanDetailInclude });
    if (!scan) throw new HttpError(404, "AI scan not found");
    const { resumeCheckpoint, manualReportStorageKey, ...publicScan } = scan;
    void manualReportStorageKey;
    const pausedForManualResume = scan.status === "AI_SCAN_INCOMPLETE" || (scan.status === "QUEUED" && scan.resumeCount > 0);
    return NextResponse.json({ scan: { ...publicScan, resumeAvailable: pausedForManualResume && hasAiScanResumeCheckpoint(resumeCheckpoint) } });
  } catch (error) { return apiError(error); }
}
