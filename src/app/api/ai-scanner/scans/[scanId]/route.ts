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
    const { resumeCheckpoint, importedReportStorageKey, evidence, ...publicScan } = scan;
    void importedReportStorageKey;
    const importedDocuments = evidence.map((item) => {
      const metadata = typeof item.metadata === "object" && item.metadata !== null && !Array.isArray(item.metadata) ? item.metadata as Record<string, unknown> : {};
      const metrics = typeof metadata.metrics === "object" && metadata.metrics !== null && !Array.isArray(metadata.metrics) ? metadata.metrics as Record<string, unknown> : {};
      const extraction = typeof metadata.extraction === "object" && metadata.extraction !== null && !Array.isArray(metadata.extraction) ? metadata.extraction as Record<string, unknown> : {};
      const sha256 = typeof metadata.rawSha256 === "string" ? metadata.rawSha256 : "";
      return {
        id: item.id,
        originalName: typeof metadata.originalName === "string" ? metadata.originalName : "Imported document",
        mimeType: item.mimeType ?? "application/octet-stream",
        sizeBytes: typeof metadata.sizeBytes === "number" ? metadata.sizeBytes : 0,
        sha256,
        active: Boolean(sha256 && sha256 === scan.importedReportSha256),
        uploadedAt: typeof metadata.uploadedAt === "string" ? metadata.uploadedAt : item.capturedAt,
        pageCount: typeof metadata.pageCount === "number" ? metadata.pageCount : 0,
        characterCount: typeof metadata.characterCount === "number" ? metadata.characterCount : 0,
        ocrPageCount: typeof extraction.ocrPages === "number" ? extraction.ocrPages : 0,
        source: typeof metrics.source === "string" ? metrics.source : "IMPORTED_DOCUMENT",
      };
    }).sort((left, right) => Number(right.active) - Number(left.active) || new Date(right.uploadedAt).getTime() - new Date(left.uploadedAt).getTime());
    const importedReportActive = Boolean(scan.importedReportUploadedAt);
    const pausedForManualResume = scan.status === "AI_SCAN_INCOMPLETE" || (scan.status === "QUEUED" && scan.resumeCount > 0);
    return NextResponse.json({ scan: {
      ...publicScan,
      ...(importedReportActive ? {
        status: "COMPLETED",
        model: `Imported ${scan.importedReportMimeType === "application/pdf" ? "PDF" : scan.importedReportMimeType === "application/json" ? "JSON" : "text"} document`,
        summary: scan.summary ?? "Imported document saved with complete source content.",
        error: null,
        failureCode: null,
        findings: [],
        products: [],
        toolEvents: [],
        observations: [],
        limitations: [],
      } : {}),
      importedDocuments,
      resumeAvailable: !importedReportActive && pausedForManualResume && hasAiScanResumeCheckpoint(resumeCheckpoint),
    } });
  } catch (error) { return apiError(error); }
}
