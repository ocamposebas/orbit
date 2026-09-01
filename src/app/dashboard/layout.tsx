import type { Metadata } from "next";
import { PortalShell } from "@/components/merchant-portal/portal-shell";
import { getPortalContext } from "@/merchant-portal/access";

export const metadata: Metadata = { title: "Merchant Portal", description: "Payments, balances and payouts for your ORBIT merchant account.", robots: { index: false, follow: false } };

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { session, merchant, merchants } = await getPortalContext();
  return <PortalShell merchantName={merchant?.businessName ?? "No merchant assigned"} merchantId={merchant?.id ?? ""} merchants={merchants.map((item) => ({ id: item.id, businessName: item.businessName }))} userName={session.user.name ?? session.user.email}>{children}</PortalShell>;
}
