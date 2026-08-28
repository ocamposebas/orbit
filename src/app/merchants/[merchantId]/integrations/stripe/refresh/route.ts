import { NextResponse, type NextRequest } from "next/server";
import { requestSession } from "@/sentinel/auth/session";
import { requireMerchantAccess } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { auditStripeConnectError, createStripeOnboardingLink } from "@/stripe/service";
import { merchantStripeDashboardPath, orbitLoginUrl, orbitRedirectUrl, requireValidMerchantId, stripeRefreshPath } from "@/stripe/onboarding-navigation";

export const runtime = "nodejs";

function errorStatus(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId: rawMerchantId } = await params;
  let merchantId: string;
  try {
    merchantId = requireValidMerchantId(rawMerchantId);
  } catch {
    return NextResponse.json({ error: "Invalid merchant refresh request" }, { status: 400 });
  }

  try {
    const session = await requestSession(request);
    if (!session) return NextResponse.redirect(orbitLoginUrl(stripeRefreshPath(merchantId)), { status: 303 });

    let actorId: string | undefined;
    try {
      const access = await requireMerchantAccess(request, merchantId, { allowedRoles: ["OWNER", "ADMIN", "REVIEWER", "VIEWER"] });
      actorId = access.session.user.id;
      await enforceRateLimit(request, `stripe-refresh:${merchantId}:${actorId}`, 10);
      const { url } = await createStripeOnboardingLink(merchantId, actorId);
      const stripeUrl = new URL(url);
      if (stripeUrl.protocol !== "https:") throw Object.assign(new Error("Stripe returned an invalid Account Link"), { status: 502 });
      return NextResponse.redirect(stripeUrl, { status: 303 });
    } catch (error) {
      if (actorId) await auditStripeConnectError(merchantId, actorId, "refresh", error);
      const status = errorStatus(error);
      if (status === 401) return NextResponse.redirect(orbitLoginUrl(stripeRefreshPath(merchantId)), { status: 303 });
      if (status === 403 || status === 404) return NextResponse.redirect(orbitRedirectUrl("/sentinel?stripeReturn=unauthorized"), { status: 303 });
      return NextResponse.redirect(orbitRedirectUrl(merchantStripeDashboardPath(merchantId, "error")), { status: 303 });
    }
  } catch {
    return NextResponse.json({ error: "Unable to renew Stripe onboarding. Sign in to ORBIT and open the merchant's Stripe integration." }, { status: 503 });
  }
}
