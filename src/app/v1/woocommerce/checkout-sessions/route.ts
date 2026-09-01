import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authenticateWooCommerceRequest } from "@/commerce/woocommerce/request-auth";
import { createOrReuseWooCommercePaymentSession, wooCommerceCheckoutUrl } from "@/commerce/woocommerce/hosted-payments";
import { parseWooCommerceJson } from "@/commerce/woocommerce/http";
import { apiError } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const orderId = z.union([
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER).transform(String),
  z.string().regex(/^[1-9]\d{0,15}$/),
]);
const schema = z.object({
  platform: z.literal("woocommerce"),
  merchant_id: z.string().regex(/^mrc_[A-Za-z0-9_-]{6,}$/),
  installation_id: z.string().regex(/^ins_[A-Za-z0-9_-]{6,}$/),
  order: z.object({
    id: orderId,
    number: z.union([z.string(), z.number()]),
    key: z.string(),
    currency: z.string().regex(/^[A-Za-z]{3}$/),
    amount_minor: z.number().int().positive(),
    items: z.array(z.unknown()),
    customer: z.record(z.string(), z.unknown()),
  }),
  return_url: z.string().url().max(2_048),
  cancel_url: z.string().url().max(2_048),
  callback_url: z.string().url().max(2_048),
  idempotency_key: z.string().trim().min(1).max(200),
});

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const installation = await authenticateWooCommerceRequest(request, rawBody);
    await enforceRateLimit(request, "woocommerce-checkout-session", 30, installation.id);
    const input = schema.parse(parseWooCommerceJson(rawBody));
    if (input.merchant_id !== installation.publicMerchantId || input.installation_id !== installation.id) {
      return NextResponse.json({ error: "WooCommerce installation identity mismatch" }, { status: 403 });
    }
    const session = await createOrReuseWooCommercePaymentSession({
      installation,
      orderId: input.order.id,
      returnUrl: input.return_url,
      cancelUrl: input.cancel_url,
      callbackUrl: input.callback_url,
      pluginIdempotencyKey: input.idempotency_key,
    });
    return NextResponse.json({
      id: session.id,
      checkout_url: wooCommerceCheckoutUrl(session.id),
      expires_at: session.expiresAt.toISOString(),
    }, { headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return apiError(error); }
}
