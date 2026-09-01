import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { exchangeWooCommerceConnectionCode } from "@/commerce/woocommerce/installations";
import { parseWooCommerceJson } from "@/commerce/woocommerce/http";
import { apiError } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  connection_code: z.string().trim().regex(/^orb_(?:test|live)_[A-Za-z0-9_-]{12,}$/),
  site_url: z.string().trim().url().max(2_048).optional(),
  origin: z.string().trim().url().max(2_048).optional(),
  callback_url: z.string().trim().url().max(2_048).optional(),
  health_url: z.string().trim().url().max(2_048).optional(),
  environment: z.enum(["test", "live"]).optional(),
  plugin_version: z.string().trim().min(1).max(64).optional(),
  woocommerce_version: z.string().trim().min(1).max(64).optional(),
  wordpress_version: z.string().trim().min(1).max(64).optional(),
}).refine((value) => Boolean(value.site_url ?? value.origin), { message: "WooCommerce site origin is required" });

export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit(request, "woocommerce-installation-exchange", 10);
    const input = schema.parse(parseWooCommerceJson(await request.text()));
    const result = await exchangeWooCommerceConnectionCode({
      code: input.connection_code,
      origin: input.site_url ?? input.origin!,
      environment: input.environment ? (input.environment === "live" ? "LIVE" : "TEST") : undefined,
      pluginVersion: input.plugin_version,
      wooCommerceVersion: input.woocommerce_version,
      wordPressVersion: input.wordpress_version,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return apiError(error); }
}
