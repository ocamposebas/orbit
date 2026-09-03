import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireMerchantAccess } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { auditStripeConnectError, createStripeEmbeddedOnboardingSession } from "@/stripe/service";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  let context: { merchantId: string; actorId: string } | undefined;
  try {
    const { merchantId } = await params;
    const { session } = await requireMerchantAccess(request, merchantId, { allowedRoles: ["OWNER", "ADMIN", "REVIEWER", "VIEWER"], mutation: true });
    context = { merchantId, actorId: session.user.id };
    await enforceRateLimit(request, `stripe-embedded-session:${merchantId}:${session.user.id}`, 20);
    const accountSession = await createStripeEmbeddedOnboardingSession(merchantId, session.user.id);
    return NextResponse.json(accountSession, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    if (context) await auditStripeConnectError(context.merchantId, context.actorId, "embedded_onboarding", error);
    return apiError(error);
  }
}
