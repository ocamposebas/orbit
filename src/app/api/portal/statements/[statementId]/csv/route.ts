import { type NextRequest } from "next/server";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, requirePortalMerchantAccess } from "@/sentinel/http";
import { statementCsv } from "@/statements/csv";

export async function GET(request: NextRequest, { params }: { params: Promise<{ statementId: string }> }) {
  try {
    const { statementId } = await params;
    const statement = await getDatabase().merchantStatement.findUnique({ where: { publicId: statementId }, include: { lineItems: { orderBy: { occurredAt: "asc" } } } });
    if (!statement) throw new HttpError(404, "Statement not found");
    await requirePortalMerchantAccess(request, statement.merchantId);
    if (statement.status !== "FINALIZED") throw new HttpError(409, "Statement is not finalized");
    const body = statementCsv(statement.lineItems.map((item) => ({ ...item })), statement.currency);
    return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${statement.publicId}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return apiError(error); }
}
