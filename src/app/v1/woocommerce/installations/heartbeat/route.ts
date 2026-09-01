import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authenticateWooCommerceRequest } from "@/commerce/woocommerce/request-auth";
import { parseWooCommerceJson } from "@/commerce/woocommerce/http";
import { getDatabase } from "@/sentinel/db";
import { apiError } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  site_url: z.string().trim().url().max(2_048).optional(),
  plugin_version: z.string().trim().min(1).max(64).optional(),
  woocommerce_version: z.string().trim().min(1).max(64).optional(),
  wordpress_version: z.string().trim().min(1).max(64).optional(),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const installation = await authenticateWooCommerceRequest(request, rawBody);
    await enforceRateLimit(request, "woocommerce-heartbeat", 30, installation.id);
    const input = schema.parse(parseWooCommerceJson(rawBody));
    const checkedAt = new Date();
    await getDatabase().wooCommerceInstallation.update({ where: { id: installation.id }, data: {
      lastSeenAt: checkedAt,
      pluginVersion: input.plugin_version,
      wooCommerceVersion: input.woocommerce_version,
      wordPressVersion: input.wordpress_version,
    } });
    return NextResponse.json({ ok: true, status: "connected", checked_at: checkedAt.toISOString() }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) { return apiError(error); }
}
