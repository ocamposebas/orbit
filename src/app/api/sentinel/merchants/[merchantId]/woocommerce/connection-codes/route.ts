import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createWooCommerceConnectionCode } from "@/commerce/woocommerce/installations";
import { getDatabase } from "@/sentinel/db";
import { apiError, requireMerchantAccess } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";

const schema = z.object({ environment: z.enum(["test", "live"]).default("live") }).strict();

export async function POST(request: NextRequest, context: RouteContext<"/api/sentinel/merchants/[merchantId]/woocommerce/connection-codes">) {
  try {
    const { merchantId } = await context.params;
    const { session, organization } = await requireMerchantAccess(request, merchantId, { allowedRoles: ["OWNER", "ADMIN"], mutation: true });
    await enforceRateLimit(request, "woocommerce-connection-code", 5, `${merchantId}:${session.user.id}`);
    const input = schema.parse(await request.json().catch(() => ({})));
    const result = await createWooCommerceConnectionCode({ merchantId, createdById: session.user.id, environment: input.environment === "live" ? "LIVE" : "TEST" });
    await getDatabase().auditLog.create({ data: {
      organizationId: organization.id,
      merchantId,
      actorId: session.user.id,
      action: "WOOCOMMERCE_CONNECTION_CODE_CREATED",
      targetType: "WooCommerceConnectionCode",
      targetId: merchantId,
      metadata: { environment: result.environment, expiresAt: result.expiresAt },
    } });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return apiError(error); }
}
