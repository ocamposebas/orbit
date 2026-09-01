import { Building2, ShieldCheck } from "lucide-react";
import { ProfileSecurity } from "@/components/sentinel/profile-security";
import { getPortalContext } from "@/merchant-portal/access";

export default async function MerchantSettingsPage() {
  const { session, merchants } = await getPortalContext();
  return <div className="mx-auto w-full max-w-[1120px] px-4 py-7 sm:px-7 lg:px-10 lg:py-10">
    <header className="border-b border-white/[.07] pb-6"><p className="text-[9px] font-semibold uppercase tracking-[.15em] text-[#9182f0]">Merchant Portal</p><h1 className="mt-2 text-[28px] font-semibold tracking-[-.05em] text-white">Settings</h1><p className="mt-2 text-[11px] text-[#777c88]">Manage your account without leaving the financial portal.</p></header>
    <section className="mt-7 grid gap-4 md:grid-cols-2"><div className="rounded-[20px] border border-white/[.075] bg-[#0c0e14] p-5"><div className="flex items-center gap-2 text-[11px] font-medium text-[#dfe1e6]"><ShieldCheck className="size-4 text-[#9182f0]" />Signed-in account</div><dl className="mt-5 space-y-4"><div><dt className="text-[8px] uppercase tracking-[.12em] text-[#5f6470]">Email</dt><dd className="mt-1 text-[10px] text-[#b7bac2]">{session.user.email}</dd></div><div><dt className="text-[8px] uppercase tracking-[.12em] text-[#5f6470]">Workspace role</dt><dd className="mt-1 text-[10px] text-[#b7bac2]">{session.role.replaceAll("_", " ")}</dd></div></dl></div><div className="rounded-[20px] border border-white/[.075] bg-[#0c0e14] p-5"><div className="flex items-center gap-2 text-[11px] font-medium text-[#dfe1e6]"><Building2 className="size-4 text-[#9182f0]" />Visible financial brands</div><div className="mt-4 flex flex-wrap gap-2">{merchants.length ? merchants.map((merchant) => <span key={merchant.id} className="rounded-full border border-[#7868e8]/20 bg-[#7868e8]/[.07] px-3 py-1.5 text-[9px] text-[#aaa1f5]">{merchant.businessName}</span>) : <p className="text-[10px] text-[#686d78]">No financial brands assigned.</p>}</div></div></section>
    <div className="-mx-4 sm:-mx-7 lg:-mx-10"><ProfileSecurity email={session.user.email} role={session.role} /></div>
  </div>;
}
