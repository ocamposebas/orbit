import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, requirePortalMerchantAccess } from "@/sentinel/http";
import { enqueueStatementEmail } from "@/statements/queue";

export async function POST(request: NextRequest, { params }: { params: Promise<{ statementId: string }> }) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    const { statementId } = await params;
    const statement = await getDatabase().merchantStatement.findUnique({ where: { publicId: statementId }, select: { id: true, merchantId: true, status: true } });
    if (!statement) throw new HttpError(404, "Statement not found");
    const { session, merchant } = await requirePortalMerchantAccess(request, statement.merchantId, { mutation: true });
    const grant = await getDatabase().merchantAccess.findUnique({ where: { userId_merchantId: { userId: session.user.id, merchantId: merchant.id } }, select: { canManageStatements: true } });
    if (!["OWNER", "ADMIN"].includes(session.role) && !grant?.canManageStatements) throw new HttpError(403, "This role cannot email statements");
    if (statement.status !== "FINALIZED") throw new HttpError(409, "Statement is not finalized");
    await enqueueStatementEmail(statement.id, 1, 0, session.user.id, requestId);
    await getDatabase().$transaction([
      getDatabase().merchantStatement.update({ where: { id: statement.id }, data: { emailStatus: "PENDING" } }),
      getDatabase().auditLog.create({ data: { organizationId: merchant.organizationId, merchantId: merchant.id, actorId: session.user.id, action: "STATEMENT_EMAIL_QUEUED", targetType: "MerchantStatement", targetId: statement.id, requestId } }),
    ]);
    return NextResponse.json({ queued: true, requestId }, { status: 202 });
  } catch (error) { return apiError(error, requestId); }
}
