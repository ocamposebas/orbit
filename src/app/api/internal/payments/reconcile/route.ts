import { NextResponse, type NextRequest } from "next/server";
import { reconcileSucceededWooPayments, reconcileWooCommercePaymentEvents } from "@/payments/reconcile";
import { getServerEnv } from "@/sentinel/config";
import { apiError } from "@/sentinel/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${getServerEnv().INTERNAL_JOB_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const [legacyWooCommerce, wooCommerceEvents] = await Promise.all([reconcileSucceededWooPayments(), reconcileWooCommercePaymentEvents()]);
    return NextResponse.json({ legacyWooCommerce, wooCommerceEvents }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
