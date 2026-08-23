import { NextResponse, type NextRequest } from "next/server";
import { relayApiError, relayErrorCode } from "@/commerce/woocommerce/http";
import { checkWooCommerceRelayHealth } from "@/commerce/woocommerce/service";
import { getDatabase } from "@/sentinel/db";
import { requireMerchantAccess } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  let context: { merchantId: string; organizationId: string; actorId: string } | undefined;
  try {
    const { merchantId } = await params;
    const { session, organization } = await requireMerchantAccess(request, merchantId, { allowedRoles: ["OWNER", "ADMIN"], mutation: true });
    context = { merchantId, organizationId: organization.id, actorId: session.user.id };
    await enforceRateLimit(request, `woo-relay-test:${merchantId}:${session.user.id}`, 10);
    const integration = await checkWooCommerceRelayHealth(merchantId);
    await getDatabase().auditLog.create({ data: {
      organizationId: organization.id,
      merchantId,
      actorId: session.user.id,
      action: integration.ok ? "WOO_RELAY_HEALTH_CHECK" : "WOO_RELAY_HEALTH_FAILED",
      targetType: "WooCommerceRelayIntegration",
      targetId: integration.id,
      metadata: { merchantId, baseUrl: integration.baseUrl, environment: integration.environment, latency: integration.lastLatencyMs, errorCode: integration.lastErrorCode },
    } });
    return NextResponse.json({ integration }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    if (context) await getDatabase().auditLog.create({ data: {
      organizationId: context.organizationId,
      merchantId: context.merchantId,
      actorId: context.actorId,
      action: "WOO_RELAY_HEALTH_FAILED",
      targetType: "WooCommerceRelayIntegration",
      targetId: context.merchantId,
      metadata: { merchantId: context.merchantId, errorCode: relayErrorCode(error) },
    } }).catch(() => undefined);
    return relayApiError(error);
  }
}
