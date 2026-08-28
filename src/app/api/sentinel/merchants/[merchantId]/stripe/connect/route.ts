import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireMerchantAccess } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { auditStripeConnectError, connectStripeAccount, createStripeOnboardingLink } from "@/stripe/service";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  let context: { merchantId: string; actorId: string } | undefined;
  try {
    const { merchantId } = await params;
    const { session } = await requireMerchantAccess(request, merchantId, { allowedRoles: ["OWNER", "ADMIN", "REVIEWER", "VIEWER"], mutation: true });
    context = { merchantId, actorId: session.user.id };
    await enforceRateLimit(request, `stripe-connect:${merchantId}:${session.user.id}`, 5);
    const integration = await connectStripeAccount(merchantId, session.user.id);
    const { url } = await createStripeOnboardingLink(merchantId, session.user.id);
    return NextResponse.json({ integration, url }, { status: 201, headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    if (context) await auditStripeConnectError(context.merchantId, context.actorId, "connect", error);
    return apiError(error);
  }
}
