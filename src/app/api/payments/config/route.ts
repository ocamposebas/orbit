import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCustomerCheckoutConfiguration } from "@/payments/service";
import { apiError } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  configToken: z.string().trim().min(80).max(2_048),
}).strict();

export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit(request, "customer-payment-config", 60);
    const { configToken } = requestSchema.parse(await request.json());
    const configuration = await getCustomerCheckoutConfiguration(configToken);
    return NextResponse.json(configuration, {
      headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" },
    });
  } catch (error) {
    return apiError(error);
  }
}
