import { Activity, AlertTriangle, CreditCard, FileText, PlugZap, ScanSearch } from "lucide-react";
import { MerchantPortalLink } from "@/components/merchant-portal/merchant-portal-link";
import { customerMerchantIds } from "@/customers/data";
import { getPortalContext } from "@/merchant-portal/access";
import { formatPortalDateTime } from "@/merchant-portal/format";
import { getPortalActivity } from "@/operations/activity";

const icons = { payment: CreditCard, statement: FileText, scan: ScanSearch, alert: AlertTriangle, integration: PlugZap };
const colors = { payment: "text-[#83d1b4]", statement: "text-[#a99cff]", scan: "text-[#8fb7e9]", alert: "text-[#e3aa78]", integration: "text-[#b5a9fa]" };

export default async function ActivityPage() {
  const { merchant, merchants, session } = await getPortalContext();
  const scope = customerMerchantIds(session.role, merchant?.id ?? null, merchants.map((item) => item.id));
  const items = await getPortalActivity(scope);
  return <div className="mx-auto w-full max-w-[1200px] px-4 py-7 sm:px-7 lg:px-10 lg:py-10"><header><p className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[.14em] text-[#a99cff]"><Activity className="size-3.5" />Operations timeline</p><h1 className="mt-3 text-[30px] font-semibold tracking-[-.055em] text-white sm:text-[38px]">Activity</h1><p className="mt-2 text-[11px] text-[#777d89]">Payments, statements, scans, alerts and integration events in one chronological view.</p></header>
    <section className="mt-7 overflow-hidden rounded-[24px] border border-white/[.075] bg-[#0b0d13]"><div className="border-b border-white/[.07] px-5 py-5 sm:px-7"><p className="text-[9px] font-semibold uppercase tracking-[.12em] text-[#777d89]">Latest workspace events</p></div>{items.length ? <div>{items.map((item) => { const Icon = icons[item.kind]; return <MerchantPortalLink key={item.id} merchantId={item.merchantId} href={item.href} className="grid w-full grid-cols-[40px_1fr_auto] items-center gap-3 border-b border-white/[.055] px-5 py-4 text-left last:border-0 hover:bg-[#8f7dff]/[.025] sm:px-7"><span className="grid size-9 place-items-center rounded-xl border border-white/[.06] bg-white/[.025]"><Icon className={`size-3.5 ${colors[item.kind]}`} /></span><span className="min-w-0"><span className="block truncate text-[11px] font-medium text-[#dfe1e6]">{item.title}</span><span className="mt-1 block truncate text-[8px] text-[#666c78]">{item.merchantName} · {item.description}</span></span><span className="text-right"><span className="block text-[8px] uppercase text-[#777d89]">{item.status.replaceAll("_", " ")}</span><span className="mt-1 block text-[8px] text-[#555b67]">{formatPortalDateTime(item.occurredAt)} UTC</span></span></MerchantPortalLink>; })}</div> : <div className="px-6 py-20 text-center"><Activity className="mx-auto size-6 text-[#8f82ef]" /><h2 className="mt-4 text-[15px] font-semibold text-white">No activity yet</h2><p className="mt-2 text-[10px] text-[#686e79]">Operational events will appear here automatically.</p></div>}</section>
  </div>;
}
