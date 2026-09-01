import { NextResponse, type NextRequest } from "next/server";
import { authenticateWooCommerceRequest } from "@/commerce/woocommerce/request-auth";
import { revokeWooCommerceInstallation } from "@/commerce/woocommerce/installations";
import { apiError } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const installation = await authenticateWooCommerceRequest(request, rawBody);
    await enforceRateLimit(request, "woocommerce-disconnect", 5, installation.id);
    await revokeWooCommerceInstallation(installation.merchantId, installation.id);
    return NextResponse.json({ ok: true, status: "disconnected" }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) { return apiError(error); }
}
