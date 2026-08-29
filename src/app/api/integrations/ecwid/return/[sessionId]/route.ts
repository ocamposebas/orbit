import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { ecwidReturnUrl, refreshAndFinalizeEcwidSession } from "@/integrations/ecwid/service";
import { apiError } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive" };

export async function GET(request: NextRequest, context: RouteContext<"/api/integrations/ecwid/return/[sessionId]">) {
  const requestId = randomUUID();
  try {
    const { sessionId } = await context.params;
    await enforceRateLimit(request, "ecwid-return-ip", 180);
    await enforceRateLimit(request, "ecwid-return-session", 60, sessionId);
    const result = await refreshAndFinalizeEcwidSession(sessionId);
    if (result.outcome === "PAID") {
      return new Response(null, { status: 303, headers: { ...headers, Location: await ecwidReturnUrl(sessionId), "X-ORBIT-Request-ID": requestId } });
    }
    if (result.outcome === "INCOMPLETE") {
      return new Response(null, { status: 303, headers: { ...headers, Location: await ecwidReturnUrl(sessionId, "The payment was not completed. Please try again."), "X-ORBIT-Request-ID": requestId } });
    }
    return new Response(null, {
      status: 303,
      headers: { ...headers, Location: `/pay/${sessionId}?processing=1`, "X-ORBIT-Request-ID": requestId },
    });
  } catch (error) {
    return apiError(error, requestId);
  }
}
