import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createEcwidSessionCheckout } from "@/integrations/ecwid/service";
import { apiError, HttpError } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validateSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  try {
    if (new URL(origin).host !== request.nextUrl.host) throw new HttpError(403, "Cross-origin mutation rejected");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(403, "Cross-origin mutation rejected");
  }
}

export async function POST(request: NextRequest, context: RouteContext<"/api/integrations/ecwid/sessions/[sessionId]/checkout">) {
  const requestId = randomUUID();
  try {
    validateSameOrigin(request);
    const { sessionId } = await context.params;
    await enforceRateLimit(request, "ecwid-session-checkout-ip", 120);
    await enforceRateLimit(request, "ecwid-session-checkout-session", 20, sessionId);
    const checkout = await createEcwidSessionCheckout(sessionId);
    return NextResponse.json(checkout, {
      headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer", "X-ORBIT-Request-ID": requestId },
    });
  } catch (error) {
    return apiError(error, requestId);
  }
}
