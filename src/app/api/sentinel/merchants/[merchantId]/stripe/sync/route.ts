import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireMerchantAccess } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { auditStripeConnectError, syncStripeConnectAccount } from "@/stripe/service";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  let context: { merchantId: string; actorId: string } | undefined;
  try {
    const { merchantId } = await params;
    const { session } = await requireMerchantAccess(request, merchantId, { allowedRoles: ["OWNER", "ADMIN", "REVIEWER", "VIEWER"], mutation: true });
    context = { merchantId, actorId: session.user.id };
    await enforceRateLimit(request, `stripe-sync:${merchantId}:${session.user.id}`, 6);
    const integration = await syncStripeConnectAccount(merchantId, { actorId: session.user.id });
    return NextResponse.json({ integration }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (context) await auditStripeConnectError(context.merchantId, context.actorId, "sync", error);
    return apiError(error);
  }
}
