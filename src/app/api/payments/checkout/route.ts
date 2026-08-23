import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createCustomerCheckout } from "@/payments/service";
import { apiError } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  checkoutToken: z.string().trim().min(80).max(2_048),
}).strict();

export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit(request, "customer-payment-checkout", 20);
    const { checkoutToken } = requestSchema.parse(await request.json());
    const checkout = await createCustomerCheckout(checkoutToken);
    return NextResponse.json(checkout, {
      headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" },
    });
  } catch (error) {
    return apiError(error);
  }
}
