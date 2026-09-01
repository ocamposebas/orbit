import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { wooCommerceCustomerReturnUrl } from "@/commerce/woocommerce/hosted-payments";
import { getPublicPaymentSession } from "@/payments/public-session";
import { apiError, HttpError } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const secureHeaders = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive" };

export async function GET(request: NextRequest, context: RouteContext<"/api/payment-sessions/[sessionId]/cancel">) {
  const requestId = randomUUID();
  try {
    const { sessionId } = await context.params;
    await enforceRateLimit(request, "payment-session-cancel-ip", 120);
    await enforceRateLimit(request, "payment-session-cancel-session", 30, sessionId);
    const session = await getPublicPaymentSession(sessionId);
    if (session.platform !== "WOOCOMMERCE") throw new HttpError(404, "Payment session not found");
    if (session.paymentStatus === "SUCCEEDED") throw new HttpError(409, "A successful payment cannot be canceled from the browser");
    return new Response(null, { status: 303, headers: { ...secureHeaders, Location: await wooCommerceCustomerReturnUrl(sessionId, "cancel"), "X-ORBIT-Request-ID": requestId } });
  } catch (error) { return apiError(error, requestId); }
}
