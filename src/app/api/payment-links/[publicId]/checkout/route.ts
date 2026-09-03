import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createOrbitPaymentLinkCheckout } from "@/payment-links/service";
import { apiError, validateMutationOrigin } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

const schema = z.object({ checkoutKey: z.string().uuid() }).strict();

export async function POST(request: NextRequest, { params }: RouteContext<"/api/payment-links/[publicId]/checkout">) {
  try {
    validateMutationOrigin(request);
    const { publicId } = await params;
    await enforceRateLimit(request, "public-payment-link-checkout", 12);
    const input = schema.parse(await request.json());
    const checkout = await createOrbitPaymentLinkCheckout(publicId, input.checkoutKey);
    return NextResponse.json(checkout, { headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return apiError(error); }
}
