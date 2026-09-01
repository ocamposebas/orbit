import { NextResponse, type NextRequest } from "next/server";
import { revokeWooCommerceInstallation } from "@/commerce/woocommerce/installations";
import { getDatabase } from "@/sentinel/db";
import { apiError, requireMerchantAccess } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: RouteContext<"/api/sentinel/merchants/[merchantId]/woocommerce/installations/[installationId]/revoke">) {
  try {
    const { merchantId, installationId } = await context.params;
    const { session, organization } = await requireMerchantAccess(request, merchantId, { allowedRoles: ["OWNER", "ADMIN"], mutation: true });
    await enforceRateLimit(request, "woocommerce-installation-revoke", 10, `${merchantId}:${session.user.id}`);
    await revokeWooCommerceInstallation(merchantId, installationId);
    await getDatabase().auditLog.create({ data: {
      organizationId: organization.id,
      merchantId,
      actorId: session.user.id,
      action: "WOOCOMMERCE_INSTALLATION_REVOKED",
      targetType: "WooCommerceInstallation",
      targetId: installationId,
      metadata: { installationId },
    } });
    return NextResponse.json({ ok: true, status: "revoked" }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) { return apiError(error); }
}
