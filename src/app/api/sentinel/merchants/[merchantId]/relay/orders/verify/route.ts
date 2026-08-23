import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { relayApiError, relayErrorCode } from "@/commerce/woocommerce/http";
import { verifyWooCommerceOrder } from "@/commerce/woocommerce/service";
import { getDatabase } from "@/sentinel/db";
import { requireMerchantAccess } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";

const orderIdSchema = z.union([
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  z.string().regex(/^[1-9]\d{0,15}$/).transform(Number),
]).refine(Number.isSafeInteger);

const requestSchema = z.object({ orderId: orderIdSchema }).strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  let context: { merchantId: string; organizationId: string; actorId: string; orderId?: number } | undefined;
  try {
    const { merchantId } = await params;
    const { session, organization } = await requireMerchantAccess(request, merchantId, { allowedRoles: ["OWNER", "ADMIN"], mutation: true });
    context = { merchantId, organizationId: organization.id, actorId: session.user.id };
    await enforceRateLimit(request, `woo-relay-order-verify:${merchantId}:${session.user.id}`, 20);
    const { orderId } = requestSchema.parse(await request.json());
    context.orderId = orderId;
    const order = await verifyWooCommerceOrder(merchantId, orderId);

    await getDatabase().auditLog.create({ data: {
      organizationId: organization.id,
      merchantId,
      actorId: session.user.id,
      action: "WOO_RELAY_ORDER_VERIFIED",
      targetType: "WooCommerceOrder",
      targetId: String(orderId),
      metadata: { orderId, status: order.status, currency: order.currency, paymentRequired: order.paymentRequired },
    } });

    return NextResponse.json({ order }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    if (context?.orderId) await getDatabase().auditLog.create({ data: {
      organizationId: context.organizationId,
      merchantId: context.merchantId,
      actorId: context.actorId,
      action: "WOO_RELAY_ORDER_VERIFICATION_FAILED",
      targetType: "WooCommerceOrder",
      targetId: String(context.orderId),
      metadata: { orderId: context.orderId, errorCode: relayErrorCode(error) },
    } }).catch(() => undefined);
    return relayApiError(error);
  }
}
