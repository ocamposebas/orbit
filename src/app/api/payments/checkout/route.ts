import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createCustomerCheckout, StripePaymentIntentParameterError } from "@/payments/service";
import { apiError } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  checkoutToken: z.string().trim().min(80).max(2_048),
  confirmationTokenId: z.string().regex(/^ctoken_[A-Za-z0-9_]{8,200}$/).optional(),
}).strict();

export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit(request, "customer-payment-checkout", 20);
    const { checkoutToken, confirmationTokenId } = requestSchema.parse(await request.json());
    const checkout = await createCustomerCheckout(checkoutToken, confirmationTokenId);
    return NextResponse.json(checkout, {
      headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" },
    });
  } catch (error) {
    if (error instanceof StripePaymentIntentParameterError) {
      const parameter = error.stripeParam === "unknown" ? "" : ` (parameter: ${error.stripeParam})`;
      return NextResponse.json({
        error: error.message,
        code: error.stripeCode,
        message: `${error.stripeMessage}${parameter}`,
      }, {
        status: error.status,
        headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" },
      });
    }
    return apiError(error);
  }
}
