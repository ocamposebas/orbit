import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requestSession } from "@/sentinel/auth/session";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, portalMerchantScope, validateMutationOrigin } from "@/sentinel/http";
import { portalActivationEligibility } from "@/merchant-portal/eligibility";

const schema = z.object({ merchantId: z.string().min(1) }).strict();

export async function POST(request: NextRequest) {
  try {
    validateMutationOrigin(request);
    const session = await requestSession(request);
    if (!session) throw new HttpError(401, "Authentication is required");
    const { merchantId } = schema.parse(await request.json());
    const internalAccess = ["OWNER", "ADMIN", "ANALYST"].includes(session.role);
    const merchant = await getDatabase().merchant.findFirst({
      where: { id: merchantId, ...portalMerchantScope(session), ...(internalAccess ? {} : { portalEnabled: true }) },
      select: { id: true, agreement: { select: { status: true } }, stripeConnect: { select: { displayStatus: true, cardPaymentsStatus: true, payoutsStatus: true } } },
    });
    if (!merchant || (!internalAccess && !portalActivationEligibility({ agreementStatus: merchant.agreement?.status, stripeDisplayStatus: merchant.stripeConnect?.displayStatus, cardPaymentsStatus: merchant.stripeConnect?.cardPaymentsStatus, payoutsStatus: merchant.stripeConnect?.payoutsStatus }).eligible)) throw new HttpError(404, "Merchant portal not available");
    const response = NextResponse.json({ merchantId: merchant.id });
    response.cookies.set("orbit_portal_merchant", merchant.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
    return response;
  } catch (error) { return apiError(error); }
}
