import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, requireRole } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

const reviewSchema = z.object({ decision: z.enum(["CONFIRM", "FALSE_POSITIVE", "ACCEPT_RISK", "RESOLVE", "REOPEN", "IGNORE", "NOTE"]), note: z.string().trim().max(2_000).optional() });
const statusByDecision = { CONFIRM: "CONFIRMED", FALSE_POSITIVE: "FALSE_POSITIVE", ACCEPT_RISK: "ACCEPTED_RISK", RESOLVE: "RESOLVED", REOPEN: "OPEN", IGNORE: "IGNORED", NOTE: undefined } as const;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ findingId: string }> }) {
  try {
    await enforceRateLimit(request, "finding-review", 60);
    const organization = await requireRole(request, ["OWNER", "ADMIN", "ANALYST", "REVIEWER"]);
    const { findingId } = await params;
    const input = reviewSchema.parse(await request.json());
    const finding = await getDatabase().finding.findFirst({ where: { id: findingId, organizationId: organization.id } });
    if (!finding) throw new HttpError(404, "Finding not found");
    const nextStatus = statusByDecision[input.decision];
    const updated = await getDatabase().$transaction(async (tx) => {
      await tx.findingReview.create({ data: { findingId, decision: input.decision, note: input.note } });
      const result = nextStatus ? await tx.finding.update({ where: { id: findingId }, data: { status: nextStatus, resolvedAt: nextStatus === "RESOLVED" ? new Date() : nextStatus === "OPEN" ? null : undefined } }) : finding;
      await tx.auditLog.create({ data: { organizationId: organization.id, merchantId: finding.merchantId, action: "finding.reviewed", targetType: "Finding", targetId: findingId, metadata: { decision: input.decision, note: input.note ?? null } } });
      return result;
    });
    return NextResponse.json({ finding: updated });
  } catch (error) { return apiError(error); }
}
