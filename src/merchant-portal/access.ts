import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { currentSession } from "@/sentinel/auth/session";
import { getDatabase } from "@/sentinel/db";
import { portalMerchantScope } from "@/sentinel/http";
import { portalActivationEligibility } from "./eligibility";

export async function getPortalContext() {
  const session = await currentSession();
  if (!session) redirect("/login?next=/dashboard");

  const merchants = await getDatabase().merchant.findMany({
    where: portalMerchantScope(session),
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      organizationId: true,
      businessName: true,
      slug: true,
      status: true,
      portalEnabled: true,
      portalEnabledAt: true,
      monthlyStatementEmailEnabled: true,
      accessGrants: { where: { userId: session.user.id }, select: { canInitiatePayouts: true, canManageStatements: true } },
      agreement: { select: { status: true } },
      stripeConnect: {
        select: {
          stripeAccountId: true,
          stripeEnvironment: true,
          displayStatus: true,
          cardPaymentsStatus: true,
          payoutsStatus: true,
          lastSyncedAt: true,
        },
      },
    },
  });
  const internalAccess = ["OWNER", "ADMIN", "ANALYST"].includes(session.role);
  const visibleMerchants = internalAccess ? merchants : merchants.filter((merchant) => merchant.portalEnabled && portalActivationEligibility({
    agreementStatus: merchant.agreement?.status,
    stripeDisplayStatus: merchant.stripeConnect?.displayStatus,
    cardPaymentsStatus: merchant.stripeConnect?.cardPaymentsStatus,
    payoutsStatus: merchant.stripeConnect?.payoutsStatus,
  }).eligible);
  const availableMerchants = visibleMerchants.map((item) => ({
    ...item,
    canInitiatePayouts: ["OWNER", "ADMIN"].includes(session.role) || Boolean(item.accessGrants[0]?.canInitiatePayouts),
    canManageStatements: ["OWNER", "ADMIN"].includes(session.role) || Boolean(item.accessGrants[0]?.canManageStatements),
  }));
  if (availableMerchants.length === 0 && session.role !== "OWNER" && !session.portalAllMerchants) redirect("/portal-access");
  const selectedMerchantId = (await cookies()).get("orbit_portal_merchant")?.value;
  const merchant = availableMerchants.find((item) => item.id === selectedMerchantId) ?? availableMerchants[0] ?? null;

  return { session, merchant, merchants: availableMerchants, internalAccess };
}
