import { NextResponse, type NextRequest } from "next/server";
import { getOrbitPaymentLinkPaymentStatus } from "@/payment-links/service";
import { apiError } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export async function GET(request: NextRequest, { params }: RouteContext<"/api/payment-links/[publicId]/payments/[paymentPublicId]">) {
  try {
    const { publicId, paymentPublicId } = await params;
    await enforceRateLimit(request, "public-payment-link-status", 60);
    const payment = await getOrbitPaymentLinkPaymentStatus(publicId, paymentPublicId);
    return NextResponse.json({ status: payment.status, updatedAt: payment.updatedAt.toISOString() }, { headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return apiError(error); }
}
