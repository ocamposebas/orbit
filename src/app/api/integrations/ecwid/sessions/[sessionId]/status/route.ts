import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicEcwidCheckout } from "@/integrations/ecwid/service";
import { apiError } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: RouteContext<"/api/integrations/ecwid/sessions/[sessionId]/status">) {
  const requestId = randomUUID();
  try {
    const { sessionId } = await context.params;
    await enforceRateLimit(request, "ecwid-session-status-ip", 300);
    await enforceRateLimit(request, "ecwid-session-status-session", 120, sessionId);
    const session = await getPublicEcwidCheckout(sessionId);
    return NextResponse.json({ paymentStatus: session.paymentStatus, syncStatus: session.syncStatus }, {
      headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer", "X-ORBIT-Request-ID": requestId },
    });
  } catch (error) {
    return apiError(error, requestId);
  }
}
