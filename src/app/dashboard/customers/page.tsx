import Link from "next/link";
import { Activity, ArrowLeft, ArrowRight, CreditCard, Search, ShieldCheck, Store, UserPlus, UsersRound } from "lucide-react";
import { MerchantPortalLink } from "@/components/merchant-portal/merchant-portal-link";
import { customerMerchantIds, listCustomers } from "@/customers/data";
import { getPortalContext } from "@/merchant-portal/access";
import { formatMoney, formatPortalDate } from "@/merchant-portal/format";

type Query = { query?: string | string[]; page?: string | string[] };
const textValue = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;

function pageHref(query: string, page: number) {
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return `/dashboard/customers${suffix ? `?${suffix}` : ""}`;
}

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Query> }) {
  const [{ merchant, merchants, session }, queryParams] = await Promise.all([getPortalContext(), searchParams]);
  const portfolio = ["OWNER", "ADMIN"].includes(session.role);
  const query = textValue(queryParams.query)?.trim().slice(0, 120) ?? "";
  const requestedPage = Number(textValue(queryParams.page) ?? "1");
  const merchantIds = customerMerchantIds(session.role, merchant?.id ?? null, merchants.map((item) => item.id));
  const result = await listCustomers(merchantIds, { query, page: requestedPage });
  const cards = [
    { label: "Total customers", value: result.summary.totalCustomers, detail: portfolio ? "Across authorized brands" : "Known payer profiles", icon: UsersRound },
    { label: "New · 30 days", value: result.summary.newCustomers, detail: "First payment activity", icon: UserPlus },
    { label: "Active · 30 days", value: result.summary.activeCustomers, detail: "Recent payment activity", icon: Activity },
    { label: "Brands represented", value: result.summary.brandsRepresented, detail: portfolio ? "With identified customers" : "Current account only", icon: Store },
  ];

  return <div className="mx-auto w-full max-w-[1540px] px-4 py-7 sm:px-7 lg:px-10 lg:py-10">
    <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div><p className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[.14em] text-[#a99cff]"><UsersRound className="size-3.5" />ORBIT Payment · Directory</p><h1 className="mt-3 text-[30px] font-semibold tracking-[-.055em] text-white sm:text-[38px]">Customers</h1><p className="mt-2 max-w-2xl text-[11px] leading-5 text-[#777d89]">Every customer identified from payment activity, kept private to the correct merchant account.</p></div>
      <span className="inline-flex w-fit items-center gap-2 rounded-full border border-[#63caa5]/15 bg-[#63caa5]/[.05] px-3 py-2 text-[8px] text-[#82cdb2]"><ShieldCheck className="size-3.5" />{portfolio ? "Authorized ORBIT portfolio" : "Current account only"}</span>
    </header>

    <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map((card) => { const Icon = card.icon; return <article key={card.label} className="rounded-[20px] border border-white/[.075] bg-[#0b0d13] p-5 shadow-[0_20px_60px_rgba(0,0,0,.12)]"><div className="flex items-center justify-between"><span className="grid size-9 place-items-center rounded-xl border border-[#8f7dff]/15 bg-[#8f7dff]/[.07] text-[#a99cff]"><Icon className="size-4" /></span><p className="text-[9px] text-[#626874]">{card.detail}</p></div><p className="mt-6 text-[28px] font-semibold tracking-[-.04em] text-white">{card.value.toLocaleString("en-US")}</p><p className="mt-1 text-[9px] font-semibold uppercase tracking-[.11em] text-[#777d89]">{card.label}</p></article>; })}</section>

    <section className="mt-6 overflow-hidden rounded-[24px] border border-white/[.075] bg-[#0b0d13] shadow-[0_25px_70px_rgba(0,0,0,.18)]">
      <div className="flex flex-col gap-4 border-b border-white/[.07] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7"><div><p className="text-[9px] font-semibold uppercase tracking-[.12em] text-[#777d89]">Customer directory</p><h2 className="mt-2 text-[17px] font-semibold text-white">{portfolio ? "All customer profiles" : merchant?.businessName ?? "Customer profiles"}</h2></div><form className="relative w-full sm:w-[300px]"><label className="sr-only" htmlFor="customer-search">Search customers</label><Search className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-[#666c78]" /><input id="customer-search" name="query" defaultValue={query} placeholder="Search name, email or brand" className="h-10 w-full rounded-xl border border-white/[.085] bg-white/[.025] pl-10 pr-20 text-[10px] text-white outline-none placeholder:text-[#555b67] focus:border-[#8f7dff]/40" /><button className="absolute right-1.5 top-1.5 h-7 rounded-lg bg-[#7868e8]/15 px-3 text-[8px] font-semibold text-[#b7aefa]">Search</button></form></div>

      {result.rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left"><thead><tr className="border-b border-white/[.06] bg-white/[.018]">{["Customer", ...(portfolio ? ["Brand"] : []), "Payments", "First seen", "Last activity", "Recent payment", ""].map((heading) => <th key={heading || "action"} className="px-4 py-3 text-[8px] font-semibold uppercase tracking-[.08em] text-[#626874] first:pl-7">{heading}</th>)}</tr></thead><tbody>{result.rows.map((customer) => {
        const paymentHref = `/dashboard/payments/${encodeURIComponent(customer.lastPaymentPublicId)}`;
        const actionClass = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#8f7dff]/20 bg-[#8f7dff]/[.06] px-3 text-[8px] font-semibold text-[#b1a7fa] transition hover:bg-[#8f7dff]/[.12]";
        return <tr key={`${customer.merchantId}:${customer.email}`} className="border-b border-white/[.055] last:border-0 hover:bg-[#8f7dff]/[.025]"><td className="py-4 pl-7 pr-4"><div className="flex items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#7868e8]/12 text-[10px] font-semibold text-[#b3a9ff]">{(customer.name ?? customer.email).split(/\s+|@/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span><span className="block text-[11px] font-medium text-[#e1e3e8]">{customer.name ?? "Customer"}</span><span className="mt-1 block text-[9px] text-[#747a86]">{customer.email}</span></span></div></td>{portfolio && <td className="px-4 text-[10px] text-[#a4a8b2]">{customer.merchantName}</td>}<td className="px-4"><span className="text-[11px] font-semibold text-white">{customer.successfulPayments}</span><span className="ml-1.5 text-[8px] text-[#656b76]">successful · {customer.paymentCount} total</span></td><td className="px-4 text-[9px] text-[#858b96]">{formatPortalDate(customer.firstSeenAt)}</td><td className="px-4 text-[9px] text-[#afb3bc]">{formatPortalDate(customer.lastSeenAt)}</td><td className="px-4"><span className="block text-[10px] font-semibold tabular-nums text-[#e1e3e8]">{formatMoney(customer.lastPaymentAmountMinor, customer.lastPaymentCurrency)}</span><span className="mt-1 block font-mono text-[8px] text-[#656b76]">{customer.lastPaymentPublicId}</span></td><td className="px-4 pr-7">{portfolio ? <MerchantPortalLink merchantId={customer.merchantId} href={paymentHref} className={actionClass} ariaLabel={`Open latest payment for ${customer.email}`}><CreditCard className="size-3" />View</MerchantPortalLink> : <Link href={paymentHref} className={actionClass}><CreditCard className="size-3" />View</Link>}</td></tr>;
      })}</tbody></table></div> : <div className="px-6 py-20 text-center"><span className="mx-auto grid size-12 place-items-center rounded-2xl border border-[#8f7dff]/15 bg-[#8f7dff]/[.07] text-[#9f93f5]"><UsersRound className="size-4" /></span><h2 className="mt-4 text-[15px] font-semibold text-white">{query ? "No customers match this search" : "No identified customers yet"}</h2><p className="mx-auto mt-2 max-w-lg text-[10px] leading-5 text-[#6f7581]">{query ? "Try another name, email address or brand." : "A customer appears here when a payment includes a valid payer email. Existing payments and financial records are never changed."}</p></div>}

      {(result.hasPrevious || result.hasNext) && <div className="flex items-center justify-between border-t border-white/[.06] px-5 py-4"><div>{result.hasPrevious && <Link href={pageHref(query, result.page - 1)} className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-white/[.08] px-3.5 text-[10px] text-[#aaaeb7]"><ArrowLeft className="size-3.5" />Previous</Link>}</div><span className="text-[8px] uppercase tracking-[.1em] text-[#5f6570]">Page {result.page}</span><div>{result.hasNext && <Link href={pageHref(query, result.page + 1)} className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-white/[.08] px-3.5 text-[10px] text-[#aaaeb7]">Next<ArrowRight className="size-3.5" /></Link>}</div></div>}
    </section>
  </div>;
}
