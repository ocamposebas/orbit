import { NextResponse, type NextRequest } from "next/server";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, requirePortalMerchantAccess } from "@/sentinel/http";

export const runtime = "nodejs";
export async function GET(request: NextRequest, { params }: { params: Promise<{ statementId: string }> }) {
  try {
    const { statementId } = await params;
    const statement = await getDatabase().merchantStatement.findUnique({ where: { publicId: statementId }, select: { id: true, merchantId: true, publicId: true, status: true, pdfData: true, merchant: { select: { organizationId: true } } } });
    if (!statement) throw new HttpError(404, "Statement not found");
    const { session } = await requirePortalMerchantAccess(request, statement.merchantId);
    if (statement.status !== "FINALIZED" || !statement.pdfData) throw new HttpError(409, "Statement PDF is not available");
    await getDatabase().auditLog.create({ data: { organizationId: statement.merchant.organizationId, merchantId: statement.merchantId, actorId: session.user.id, action: "STATEMENT_PDF_DOWNLOADED", targetType: "MerchantStatement", targetId: statement.id } });
    return new NextResponse(new Uint8Array(statement.pdfData), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${statement.publicId}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return apiError(error); }
}
