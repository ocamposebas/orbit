import type { Metadata } from "next";
import { Clock3, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { currentSession } from "@/sentinel/auth/session";
import { getDatabase } from "@/sentinel/db";
import { merchantScope } from "@/sentinel/http";
import { PortalAccessSignOut } from "@/components/merchant-portal/portal-access-sign-out";
import { portalActivationEligibility } from "@/merchant-portal/eligibility";

export const metadata: Metadata = { title: "Portal access pending", robots: { index: false, follow: false } };

export default async function PortalAccessPage() {
  const session = await currentSession();
  if (!session) redirect("/login?next=/dashboard");
  const merchants = await getDatabase().merchant.findMany({ where: merchantScope(session), select: { id: true, businessName: true, portalEnabled: true, agreement: { select: { status: true } }, stripeConnect: { select: { displayStatus: true, cardPaymentsStatus: true, payoutsStatus: true } } } });
  if (merchants.some((merchant) => merchant.portalEnabled && portalActivationEligibility({ agreementStatus: merchant.agreement?.status, stripeDisplayStatus: merchant.stripeConnect?.displayStatus, cardPaymentsStatus: merchant.stripeConnect?.cardPaymentsStatus, payoutsStatus: merchant.stripeConnect?.payoutsStatus }).eligible) || ["OWNER", "ADMIN", "ANALYST"].includes(session.role)) redirect("/dashboard");
  return <main className="grid min-h-dvh place-items-center bg-[#07080d] px-5 py-12 text-[#f0f1f4]"><section className="w-full max-w-lg rounded-[24px] border border-white/[.075] bg-[#0c0e14] p-7 text-center shadow-[0_30px_90px_rgba(0,0,0,.4)] sm:p-10"><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#7868e8]/10 text-[#9b8cff]"><Clock3 className="size-5" /></span><p className="mt-6 text-[10px] font-semibold uppercase tracking-[.14em] text-[#9b8cff]">ORBIT Merchant Portal</p><h1 className="mt-3 text-[26px] font-semibold tracking-[-.045em]">Your portal access is pending</h1><p className="mx-auto mt-4 max-w-md text-[12px] leading-6 text-[#777c88]">Your ORBIT administrator will activate the financial portal after the merchant application, Stripe verification, payments capability and payouts capability are complete.</p>{merchants.length > 0 && <div className="mt-7 rounded-xl border border-white/[.07] bg-white/[.02] p-4 text-left"><p className="flex items-center gap-2 text-[10px] font-medium text-[#a4a8b1]"><ShieldCheck className="size-3.5 text-[#9182f0]" />Assigned account{merchants.length === 1 ? "" : "s"}</p><p className="mt-2 text-[10px] leading-5 text-[#6f7480]">{merchants.map((merchant) => merchant.businessName).join(", ")}</p></div>}<div className="mt-7"><PortalAccessSignOut /></div></section></main>;
}
