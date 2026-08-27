import { NextResponse, type NextRequest } from "next/server";
import { validateAiScanManualReport } from "@/ai-scanner/manual-report";
import { requestSession } from "@/sentinel/auth/session";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, merchantScope, validateMutationOrigin } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { evidenceStorage } from "@/sentinel/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  try {
    await enforceRateLimit(request, "ai-scanner-manual-report-upload", 10);
    const session = await requestSession(request);
    if (!session) throw new HttpError(401, "Authentication is required");
    if (!["OWNER", "ADMIN", "ANALYST"].includes(session.role)) throw new HttpError(403, "This role cannot upload a manual report");
    validateMutationOrigin(request);
    const { scanId } = await params;
    const db = getDatabase();
    const scan = await db.aiScan.findFirst({ where: { id: scanId, merchant: merchantScope(session) }, select: { id: true, merchantId: true, manualReportSha256: true } });
    if (!scan) throw new HttpError(404, "AI scan not found");
    const upload = await validateAiScanManualReport((await request.formData()).get("report"));
    const storageKey = `ai-scanner/${scanId}/manual-reports/${upload.sha256}.pdf`;
    await evidenceStorage().put(storageKey, upload.bytes);
    const uploadedAt = new Date();
    await db.$transaction([
      db.aiScan.update({ where: { id: scanId }, data: { manualReportStorageKey: storageKey, manualReportOriginalName: upload.originalName, manualReportMimeType: "application/pdf", manualReportSizeBytes: upload.bytes.byteLength, manualReportSha256: upload.sha256, manualReportUploadedAt: uploadedAt, manualReportUploadedById: session.user.id } }),
      db.auditLog.create({ data: { organizationId: session.organization.id, merchantId: scan.merchantId, aiScanId: scanId, actorId: session.user.id, action: "ai_scanner.manual_report_uploaded", targetType: "AiScan", targetId: scanId, metadata: { originalName: upload.originalName, sizeBytes: upload.bytes.byteLength, sha256: upload.sha256, replacedSha256: scan.manualReportSha256 } } }),
    ]);
    return NextResponse.json({ manualReport: { originalName: upload.originalName, sizeBytes: upload.bytes.byteLength, sha256: upload.sha256, uploadedAt } }, { status: 201 });
  } catch (error) { return apiError(error); }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  try {
    await enforceRateLimit(request, "ai-scanner-manual-report-download", 30);
    const session = await requestSession(request);
    if (!session) throw new HttpError(401, "Authentication is required");
    const { scanId } = await params;
    const scan = await getDatabase().aiScan.findFirst({ where: { id: scanId, merchant: merchantScope(session) }, select: { manualReportStorageKey: true, manualReportOriginalName: true } });
    if (!scan?.manualReportStorageKey) throw new HttpError(404, "No manual report has been uploaded for this scan");
    const bytes = await evidenceStorage().get(scan.manualReportStorageKey);
    if (!bytes) throw new HttpError(404, "The stored manual report could not be found");
    const name = (scan.manualReportOriginalName ?? `orbit-ai-scan-${scanId.slice(-8)}-manual-report.pdf`).replace(/[\r\n"\\/]/g, "_");
    return new NextResponse(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) { return apiError(error); }
}
