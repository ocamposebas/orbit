import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createCustomerCheckout, StripePaymentIntentParameterError } from "@/payments/service";
import { checkoutTokenRateLimitSubject } from "@/payments/rate-limit-subject";
import { apiError } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  checkoutToken: z.string().trim().min(80).max(2_048),
}).strict();

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    const { checkoutToken } = requestSchema.parse(await request.json());
    await enforceRateLimit(request, "customer-payment-checkout-ip", 300);
    await enforceRateLimit(request, "customer-payment-checkout-order", 20, checkoutTokenRateLimitSubject(checkoutToken));
    const checkout = await createCustomerCheckout(checkoutToken);
    return NextResponse.json(checkout, {
      headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer", "X-ORBIT-Request-ID": requestId },
    });
  } catch (error) {
    if (error instanceof StripePaymentIntentParameterError) {
      const parameter = error.stripeParam === "unknown" ? "" : ` (parameter: ${error.stripeParam})`;
      return NextResponse.json({
        error: error.message,
        code: error.stripeCode,
        message: `${error.stripeMessage}${parameter}`,
        requestId,
      }, {
        status: error.status,
        headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer", "X-ORBIT-Request-ID": requestId },
      });
    }
    return apiError(error, requestId);
  }
}
