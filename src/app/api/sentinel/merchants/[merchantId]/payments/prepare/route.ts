import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { preparePaymentTransaction } from "@/payments/service";
import { getDatabase } from "@/sentinel/db";
import { apiError, requireMerchantAccess } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";

const wooOrderIdSchema = z.union([
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  z.string().regex(/^[1-9]\d{0,15}$/).transform(Number),
]).refine(Number.isSafeInteger);

const requestSchema = z.object({ wooOrderId: wooOrderIdSchema }).strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  try {
    const { merchantId } = await params;
    const { session, organization } = await requireMerchantAccess(request, merchantId, { allowedRoles: ["OWNER", "ADMIN"], mutation: true });
    await enforceRateLimit(request, `payment-prepare:${merchantId}:${session.user.id}`, 20);
    const { wooOrderId } = requestSchema.parse(await request.json());
    const transaction = await preparePaymentTransaction(merchantId, wooOrderId);

    await getDatabase().auditLog.create({ data: {
      organizationId: organization.id,
      merchantId,
      actorId: session.user.id,
      action: "PAYMENT_TRANSACTION_PREPARED",
      targetType: "PaymentTransaction",
      targetId: transaction.id,
      metadata: { wooOrderId: transaction.wooOrderId, amountMinor: transaction.amountMinor, currency: transaction.currency, platformFeeBps: transaction.platformFeeBps, status: transaction.status, stripeReadiness: transaction.stripeReadiness },
    } });

    return NextResponse.json({ transaction }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    return apiError(error);
  }
}
