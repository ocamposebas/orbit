import { NextResponse, type NextRequest } from "next/server";
import { createStripePaymentIntent } from "@/payments/service";
import { getDatabase } from "@/sentinel/db";
import { apiError, requireMerchantAccess } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ merchantId: string; transactionId: string }> }) {
  try {
    const { merchantId, transactionId } = await params;
    const { session, organization } = await requireMerchantAccess(request, merchantId, { allowedRoles: ["OWNER", "ADMIN"], mutation: true });
    await enforceRateLimit(request, `payment-intent-create:${merchantId}:${session.user.id}`, 20);
    const payment = await createStripePaymentIntent(merchantId, transactionId);

    await getDatabase().auditLog.create({ data: {
      organizationId: organization.id,
      merchantId,
      actorId: session.user.id,
      action: "STRIPE_PAYMENT_INTENT_CREATED",
      targetType: "PaymentTransaction",
      targetId: payment.orbitTransactionId,
      metadata: { wooOrderId: payment.wooOrderId, stripePaymentIntentId: payment.stripePaymentIntentId, amountMinor: payment.amountMinor, currency: payment.currency, platformFeeMinor: payment.platformFeeMinor, stripeStatus: payment.stripeStatus },
    } });

    return NextResponse.json({ payment }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    return apiError(error);
  }
}
