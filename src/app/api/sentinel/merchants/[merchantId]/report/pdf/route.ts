import { NextResponse, type NextRequest } from "next/server";
import { apiError, HttpError, requireMerchantAccess } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { loadMerchantReport, renderMerchantReportPdf } from "@/sentinel/reports/merchant-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function safeFilename(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "merchant";
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  try {
    await enforceRateLimit(request, "report-pdf", 10);
    const { merchantId } = await params;
    const { organization } = await requireMerchantAccess(request, merchantId);
    const report = await loadMerchantReport(merchantId, organization.id);
    if (!report) throw new HttpError(404, "Merchant not found");
    const pdf = await renderMerchantReportPdf(report);
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(pdf), { headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="orbit-${safeFilename(report.businessName)}-${date}.pdf"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return apiError(error); }
}
