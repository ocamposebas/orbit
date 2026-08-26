import { NextResponse, type NextRequest } from "next/server";
import { findingDecisionSchema } from "@/ai-scanner/schemas";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, requireMerchantAccess } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";

const statuses = { CONFIRM: "CONFIRMED", FALSE_POSITIVE: "FALSE_POSITIVE", ACCEPT_RISK: "ACCEPTED_RISK", RESOLVE: "RESOLVED", REOPEN: "OPEN", IGNORE: "IGNORED" } as const;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ findingId: string }> }) {
  try {
    await enforceRateLimit(request, "ai-scanner-finding-review", 60);
    const { findingId } = await params;
    const finding = await getDatabase().aiFinding.findUnique({ where: { id: findingId }, select: { merchantId: true, organizationId: true, status: true } });
    if (!finding) throw new HttpError(404, "AI Scanner finding not found");
    const { session } = await requireMerchantAccess(request, finding.merchantId, { allowedRoles: ["OWNER", "ADMIN", "ANALYST", "REVIEWER"], mutation: true });
    const input = findingDecisionSchema.parse(await request.json());
    const updated = await getDatabase().aiFinding.update({ where: { id: findingId }, data: { status: statuses[input.decision] } });
    await getDatabase().auditLog.create({ data: { organizationId: finding.organizationId, merchantId: finding.merchantId, actorId: session.user.id, action: "ai_scanner.finding_reviewed", targetType: "AiFinding", targetId: findingId, metadata: { previousStatus: finding.status, decision: input.decision, note: input.note ?? null } } });
    return NextResponse.json({ finding: updated });
  } catch (error) { return apiError(error); }
}
