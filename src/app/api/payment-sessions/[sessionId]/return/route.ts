import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { wooCommerceCustomerReturnUrl } from "@/commerce/woocommerce/hosted-payments";
import { ecwidReturnUrl, refreshAndFinalizeEcwidSession } from "@/integrations/ecwid/service";
import { getPublicPaymentSession } from "@/payments/public-session";
import { apiError } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const secureHeaders = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive" };

function processingReturnUrl(value: string) {
  const url = new URL(value);
  url.searchParams.set("orbit_confirmation", "processing");
  return url.toString();
}

export async function GET(request: NextRequest, context: RouteContext<"/api/payment-sessions/[sessionId]/return">) {
  const requestId = randomUUID();
  try {
    const { sessionId } = await context.params;
    await enforceRateLimit(request, "payment-session-return-ip", 180);
    await enforceRateLimit(request, "payment-session-return-session", 60, sessionId);
    const session = await getPublicPaymentSession(sessionId);
    if (session.platform === "ECWID") {
      const result = await refreshAndFinalizeEcwidSession(sessionId);
      if (result.outcome === "PAID") return new Response(null, { status: 303, headers: { ...secureHeaders, Location: await ecwidReturnUrl(sessionId), "X-ORBIT-Request-ID": requestId } });
      if (result.outcome === "INCOMPLETE") return new Response(null, { status: 303, headers: { ...secureHeaders, Location: await ecwidReturnUrl(sessionId, "The payment was not completed. Please try again."), "X-ORBIT-Request-ID": requestId } });
      return new Response(null, { status: 303, headers: { ...secureHeaders, Location: `/pay/${sessionId}?processing=1`, "X-ORBIT-Request-ID": requestId } });
    }
    if (session.returnReady) return new Response(null, { status: 303, headers: { ...secureHeaders, Location: await wooCommerceCustomerReturnUrl(sessionId), "X-ORBIT-Request-ID": requestId } });
    if (session.paymentStatus === "SUCCEEDED" && request.nextUrl.searchParams.get("continue") === "1") {
      return new Response(null, { status: 303, headers: { ...secureHeaders, Location: processingReturnUrl(await wooCommerceCustomerReturnUrl(sessionId)), "X-ORBIT-Request-ID": requestId } });
    }
    return new Response(null, { status: 303, headers: { ...secureHeaders, Location: `/p/${sessionId}?processing=1`, "X-ORBIT-Request-ID": requestId } });
  } catch (error) { return apiError(error, requestId); }
}
