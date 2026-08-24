import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { decryptRelaySecret } from "@/commerce/woocommerce/crypto";
import { relayApiError } from "@/commerce/woocommerce/http";
import { RelayError } from "@/commerce/woocommerce/types";
import { getDatabase } from "@/sentinel/db";
import { requireMerchantAccess } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  try {
    const { merchantId } = await params;
    const { session } = await requireMerchantAccess(request, merchantId, { allowedRoles: ["OWNER", "ADMIN"] });
    await enforceRateLimit(request, `woo-relay-secret-diagnostic:${merchantId}:${session.user.id}`, 10);

    const integration = await getDatabase().wooCommerceRelayIntegration.findUnique({ where: { merchantId } });
    if (!integration) throw new RelayError(404, "RELAY_NOT_CONFIGURED", "ORBIT Relay is not configured for this merchant");

    const signingSecret = decryptRelaySecret(integration.encryptedSigningSecret, merchantId);
    const secretFingerprint = createHash("sha256").update(signingSecret, "utf8").digest("hex").slice(0, 12);

    return NextResponse.json(
      { secretFingerprint, utcTime: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (error) {
    return relayApiError(error);
  }
}
