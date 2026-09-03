import { NextResponse, type NextRequest } from "next/server";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, requireRole } from "@/sentinel/http";
import { regenerateStatementPdf } from "@/statements/service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ statementId: string }> }) {
  try { const organization = await requireRole(request, ["OWNER", "ADMIN"]); const { statementId } = await params; const statement = await getDatabase().merchantStatement.findFirst({ where: { id: statementId, merchant: { organizationId: organization.id } }, select: { id: true } }); if (!statement) throw new HttpError(404, "Statement not found"); await regenerateStatementPdf(statement.id); return NextResponse.json({ regenerated: true }); } catch (error) { return apiError(error); }
}
