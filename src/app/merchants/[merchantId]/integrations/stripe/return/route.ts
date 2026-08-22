import { NextResponse, type NextRequest } from "next/server";
import { requireMerchantAccess } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { auditStripeConnectError, syncStripeConnectAccount } from "@/stripe/service";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params;
  let actorId: string | undefined;
  try {
    const { session } = await requireMerchantAccess(request, merchantId, { allowedRoles: ["OWNER", "ADMIN"] });
    actorId = session.user.id;
    await enforceRateLimit(request, `stripe-return:${merchantId}:${session.user.id}`, 10);
    const integration = await syncStripeConnectAccount(merchantId, { actorId: session.user.id, auditAction: "STRIPE_STATUS_SYNCED" });
    const db = (await import("@/sentinel/db")).getDatabase();
    await db.auditLog.create({ data: { organizationId: session.organization.id, merchantId, actorId: session.user.id, action: "STRIPE_ONBOARDING_RETURNED", targetType: "StripeConnectIntegration", targetId: integration.id, metadata: { displayStatus: integration.displayStatus } } });
    return NextResponse.redirect(new URL(`/sentinel/merchant/${encodeURIComponent(merchantId)}?stripeReturn=1`, request.url));
  } catch (error) {
    if (actorId) await auditStripeConnectError(merchantId, actorId, "return", error);
    return NextResponse.redirect(new URL(`/sentinel/merchant/${encodeURIComponent(merchantId)}?stripeReturn=error`, request.url));
  }
}
