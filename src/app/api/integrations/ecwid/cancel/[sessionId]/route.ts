import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { cancelAndFinalizeEcwidSession, ecwidReturnUrl } from "@/integrations/ecwid/service";
import { apiError } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive" };

export async function GET(request: NextRequest, context: RouteContext<"/api/integrations/ecwid/cancel/[sessionId]">) {
  const requestId = randomUUID();
  try {
    const { sessionId } = await context.params;
    await enforceRateLimit(request, "ecwid-cancel-ip", 120);
    await enforceRateLimit(request, "ecwid-cancel-session", 20, sessionId);
    const result = await cancelAndFinalizeEcwidSession(sessionId);
    if (result.outcome === "PAID") {
      return new Response(null, { status: 303, headers: { ...headers, Location: await ecwidReturnUrl(sessionId), "X-ORBIT-Request-ID": requestId } });
    }
    if (result.outcome === "INCOMPLETE") {
      return new Response(null, { status: 303, headers: { ...headers, Location: await ecwidReturnUrl(sessionId, "The payment was canceled. Please try again."), "X-ORBIT-Request-ID": requestId } });
    }
    return new Response(null, { status: 303, headers: { ...headers, Location: `/pay/${sessionId}?processing=1`, "X-ORBIT-Request-ID": requestId } });
  } catch (error) {
    return apiError(error, requestId);
  }
}
