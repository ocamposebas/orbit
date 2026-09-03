import type { Metadata } from "next";
import { PortalShell } from "@/components/merchant-portal/portal-shell";
import { getPortalContext } from "@/merchant-portal/access";
import { getServerEnv } from "@/sentinel/config";

export const metadata: Metadata = { title: "ORBIT Payment", description: "Payments, balances and transfers for your ORBIT merchant account.", robots: { index: false, follow: false } };

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { session, merchant, merchants } = await getPortalContext();
  return <PortalShell paymentLinksEnabled={["OWNER", "ADMIN"].includes(session.role) || merchants.some((item) => item.canCreatePaymentLinks)} statementsEnabled={getServerEnv().STATEMENTS_ENABLED} merchantName={merchant?.businessName ?? "No merchant assigned"} merchantId={merchant?.id ?? ""} merchants={merchants.map((item) => ({ id: item.id, businessName: item.businessName }))} userName={session.user.name ?? session.user.email} adminPortfolio={["OWNER", "ADMIN"].includes(session.role)} ownerEarnings={session.role === "OWNER"}>{children}</PortalShell>;
}
