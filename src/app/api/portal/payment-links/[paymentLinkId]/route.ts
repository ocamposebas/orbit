import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/sentinel/db";
import { requestSession } from "@/sentinel/auth/session";
import { apiError, HttpError, portalMerchantScope, validateMutationOrigin } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

const schema = z.object({ active: z.boolean() }).strict();

export async function PATCH(request: NextRequest, { params }: RouteContext<"/api/portal/payment-links/[paymentLinkId]">) {
  try {
    validateMutationOrigin(request);
    const session = await requestSession(request);
    if (!session) throw new HttpError(401, "Authentication is required");
    await enforceRateLimit(request, "payment-link-status", 30, session.user.id);
    const { paymentLinkId } = await params;
    const input = schema.parse(await request.json());
    const db = getDatabase();
    const link = await db.orbitPaymentLink.findFirst({
      where: { id: paymentLinkId, organizationId: session.organization.id, ...(session.role === "OWNER" ? {} : { merchantId: { not: null } }) },
      include: { merchant: { select: { id: true, accessGrants: { where: { userId: session.user.id }, select: { canCreatePaymentLinks: true } } } } },
    });
    if (!link) throw new HttpError(404, "Payment link not found");
    const privileged = ["OWNER", "ADMIN"].includes(session.role);
    if (!privileged) {
      if (!link.merchant || !(await db.merchant.count({ where: { id: link.merchant.id, ...portalMerchantScope(session) } }))) throw new HttpError(404, "Payment link not found");
      if (link.createdById !== session.user.id || !link.merchant.accessGrants[0]?.canCreatePaymentLinks) throw new HttpError(403, "Only the creator or an ORBIT administrator can manage this link");
    }
    const status = input.active ? "ACTIVE" : "INACTIVE";
    const updated = await db.$transaction(async (tx) => {
      const value = await tx.orbitPaymentLink.update({ where: { id: link.id }, data: { status, deactivatedAt: input.active ? null : new Date() } });
      await tx.auditLog.create({ data: { organizationId: session.organization.id, actorId: session.user.id, merchantId: link.merchantId, action: input.active ? "orbit_payment.link_activated" : "orbit_payment.link_deactivated", targetType: "OrbitPaymentLink", targetId: link.id, metadata: { publicId: link.publicId } } });
      return value;
    });
    return NextResponse.json({ link: { id: updated.id, status: updated.status } }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) { return apiError(error); }
}
