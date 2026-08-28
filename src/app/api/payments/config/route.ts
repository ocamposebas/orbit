import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCustomerCheckoutConfiguration } from "@/payments/service";
import { configTokenRateLimitSubject } from "@/payments/rate-limit-subject";
import { apiError } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  configToken: z.string().trim().min(80).max(2_048),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const { configToken } = requestSchema.parse(await request.json());
    await enforceRateLimit(request, "customer-payment-config-ip", 600);
    await enforceRateLimit(request, "customer-payment-config-merchant", 60, configTokenRateLimitSubject(configToken));
    const configuration = await getCustomerCheckoutConfiguration(configToken);
    return NextResponse.json(configuration, {
      headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" },
    });
  } catch (error) {
    return apiError(error);
  }
}
