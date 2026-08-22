import { NextResponse, type NextRequest } from "next/server";
import { requireMerchantAccess } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { auditStripeConnectError, createStripeOnboardingLink } from "@/stripe/service";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params;
  let actorId: string | undefined;
  try {
    const { session } = await requireMerchantAccess(request, merchantId, { allowedRoles: ["OWNER", "ADMIN"] });
    actorId = session.user.id;
    await enforceRateLimit(request, `stripe-refresh:${merchantId}:${session.user.id}`, 10);
    const { url } = await createStripeOnboardingLink(merchantId, session.user.id);
    return NextResponse.redirect(url, { status: 303 });
  } catch (error) {
    if (actorId) await auditStripeConnectError(merchantId, actorId, "refresh", error);
    return NextResponse.redirect(new URL(`/sentinel/merchant/${encodeURIComponent(merchantId)}?stripeReturn=error`, request.url));
  }
}
