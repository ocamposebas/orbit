import { NextResponse, type NextRequest } from "next/server";
import { requestSession } from "@/sentinel/auth/session";
import { requireMerchantAccess } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { auditStripeConnectError, syncStripeConnectAccount } from "@/stripe/service";
import { merchantStripeDashboardPath, orbitLoginUrl, orbitRedirectUrl, requireValidMerchantId } from "@/stripe/onboarding-navigation";

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
    return NextResponse.json({ error: "Invalid merchant return request" }, { status: 400 });
  }

  const dashboardAfterLogin = merchantStripeDashboardPath(merchantId, "login");
  try {
    const session = await requestSession(request);
    if (!session) return NextResponse.redirect(orbitLoginUrl(dashboardAfterLogin), { status: 303 });

    let actorId: string | undefined;
    try {
      const access = await requireMerchantAccess(request, merchantId, { allowedRoles: ["OWNER", "ADMIN"] });
      actorId = access.session.user.id;
      await enforceRateLimit(request, `stripe-return:${merchantId}:${actorId}`, 10);
      const integration = await syncStripeConnectAccount(merchantId, { actorId, auditAction: "STRIPE_STATUS_SYNCED" });
      const db = (await import("@/sentinel/db")).getDatabase();
      await db.auditLog.create({ data: { organizationId: access.session.organization.id, merchantId, actorId, action: "STRIPE_ONBOARDING_RETURNED", targetType: "StripeConnectIntegration", targetId: integration.id, metadata: { displayStatus: integration.displayStatus } } });
      return NextResponse.redirect(orbitRedirectUrl(merchantStripeDashboardPath(merchantId, "success")), { status: 303 });
    } catch (error) {
      if (actorId) await auditStripeConnectError(merchantId, actorId, "return", error);
      const status = errorStatus(error);
      if (status === 401) return NextResponse.redirect(orbitLoginUrl(dashboardAfterLogin), { status: 303 });
      if (status === 403 || status === 404) return NextResponse.redirect(orbitRedirectUrl("/sentinel?stripeReturn=unauthorized"), { status: 303 });
      return NextResponse.redirect(orbitRedirectUrl(merchantStripeDashboardPath(merchantId, "error")), { status: 303 });
    }
  } catch {
    return NextResponse.json({ error: "Unable to complete the Stripe return. Sign in to ORBIT and open the merchant's Stripe integration." }, { status: 503 });
  }
}
