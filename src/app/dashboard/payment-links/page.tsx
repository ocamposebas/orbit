import { ShieldCheck, Sparkles } from "lucide-react";
import { PaymentLinkManager } from "@/components/merchant-portal/payment-link-manager";
import { getPortalContext } from "@/merchant-portal/access";
import { parseAppUrlConfiguration } from "@/sentinel/app-url";
import { getServerEnv } from "@/sentinel/config";

export default async function PaymentLinksPage() {
  const { session, merchants } = await getPortalContext();
  return <div className="mx-auto w-full max-w-[1480px] px-4 py-7 sm:px-7 lg:px-10 lg:py-10">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[.14em] text-[#a99cff]"><Sparkles className="size-3.5" />ORBIT Payment · No-code checkout</p><h1 className="mt-3 text-[30px] font-semibold tracking-[-.055em] text-white sm:text-[38px]">Payment links</h1><p className="mt-2 max-w-xl text-[11px] leading-5 text-[#777d89]">Create a polished checkout in seconds. Share the URL anywhere and receive payments in the correct ORBIT Payment account.</p></div><span className="inline-flex w-fit items-center gap-2 rounded-full border border-[#8f7dff]/15 bg-[#8f7dff]/[.05] px-3 py-2 text-[8px] text-[#b2a8fa]"><ShieldCheck className="size-3.5" />Destination locked server-side</span></header>
    <PaymentLinkManager role={session.role} merchants={merchants.map((merchant) => ({ id: merchant.id, businessName: merchant.businessName, allowed: merchant.canCreatePaymentLinks, ready: merchant.stripeConnect?.cardPaymentsStatus?.toLowerCase() === "active" }))} canonicalOrigin={parseAppUrlConfiguration(getServerEnv().APP_URL).canonicalOrigin} />
  </div>;
}
