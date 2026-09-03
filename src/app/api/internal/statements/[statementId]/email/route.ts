import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, requireRole } from "@/sentinel/http";
import { enqueueStatementEmail } from "@/statements/queue";

export async function POST(request: NextRequest, { params }: { params: Promise<{ statementId: string }> }) {
  const requestId = randomUUID(); try { const organization = await requireRole(request, ["OWNER", "ADMIN"]); const { statementId } = await params; const statement = await getDatabase().merchantStatement.findFirst({ where: { id: statementId, merchant: { organizationId: organization.id } } }); if (!statement) throw new HttpError(404, "Statement not found"); await enqueueStatementEmail(statement.id, 1, 0, undefined, requestId); await getDatabase().merchantStatement.update({ where: { id: statement.id }, data: { emailStatus: "PENDING" } }); return NextResponse.json({ queued: true }); } catch (error) { return apiError(error, requestId); }
}
