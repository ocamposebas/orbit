import Link from "next/link";
import { ArrowLeft, ArrowRight, CreditCard, ShieldCheck, Sparkles } from "lucide-react";
import { PaymentFilters } from "@/components/merchant-portal/payment-filters";
import { PaymentsTable } from "@/components/merchant-portal/payments-table";
import { getPortalContext } from "@/merchant-portal/access";
import { getAdminPayments, getMerchantPayments, type PaymentListInput } from "@/merchant-portal/data";

type Query = { [key: string]: string | string[] | undefined };
const textValue = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;

function paginationHref(query: Query, cursor: string, direction: "next" | "prev") {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (typeof value === "string" && !["cursor", "direction"].includes(key)) params.set(key, value);
  params.set("cursor", cursor); params.set("direction", direction);
  return `/dashboard/payments?${params.toString()}`;
}

function Pagination({ query, previousCursor, nextCursor }: { query: Query; previousCursor: string | null; nextCursor: string | null }) {
  if (!previousCursor && !nextCursor) return null;
  return <div className="flex items-center justify-between border-t border-white/[.06] px-5 py-4"><div>{previousCursor && <Link href={paginationHref(query, previousCursor, "prev")} className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-white/[.08] px-3.5 text-[10px] text-[#aaaeb7]"><ArrowLeft className="size-3.5" />Previous</Link>}</div><div>{nextCursor && <Link href={paginationHref(query, nextCursor, "next")} className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-white/[.08] px-3.5 text-[10px] text-[#aaaeb7]">Next<ArrowRight className="size-3.5" /></Link>}</div></div>;
}

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const [{ merchant, merchants, session }, query] = await Promise.all([getPortalContext(), searchParams]);
  const input: PaymentListInput = { query: textValue(query.query), status: textValue(query.status), range: textValue(query.range), from: textValue(query.from), to: textValue(query.to), cursor: textValue(query.cursor), direction: textValue(query.direction) === "prev" ? "prev" : "next" };
  const isAdminPortfolio = ["OWNER", "ADMIN"].includes(session.role) && !textValue(query.merchant);

  if (isAdminPortfolio) {
    const result = await getAdminPayments(merchants.map((item) => item.id), input);
    return <div className="mx-auto w-full max-w-[1540px] px-4 py-7 sm:px-7 lg:px-10 lg:py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[.14em] text-[#a99cff]"><Sparkles className="size-3.5" />Private admin portfolio</p><h1 className="mt-3 text-[30px] font-semibold tracking-[-.055em] text-white sm:text-[38px]">All payments</h1><p className="mt-2 text-[11px] text-[#777d89]">Customer, payment method, amount and real approval result across every ORBIT brand.</p></div><span className="inline-flex w-fit items-center gap-2 rounded-full border border-[#63caa5]/15 bg-[#63caa5]/[.05] px-3 py-2 text-[8px] text-[#82cdb2]"><ShieldCheck className="size-3.5" />Live processor detail</span></header>
      <section className="mt-7 overflow-hidden rounded-[24px] border border-white/[.075] bg-[#0b0d13] shadow-[0_25px_70px_rgba(0,0,0,.18)]"><PaymentFilters values={input} /><PaymentsTable payments={result.payments} /><Pagination query={query} previousCursor={result.previousCursor} nextCursor={result.nextCursor} /></section>
    </div>;
  }

  const requestedMerchantId = textValue(query.merchant);
  const selectedMerchant = requestedMerchantId && ["OWNER", "ADMIN"].includes(session.role) ? merchants.find((item) => item.id === requestedMerchantId) ?? merchant : merchant;
  if (!selectedMerchant) return null;
  const result = await getMerchantPayments(selectedMerchant.id, input);
  return <div className="mx-auto w-full max-w-[1480px] px-4 py-7 sm:px-7 lg:px-10 lg:py-10">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[.14em] text-[#a99cff]"><CreditCard className="size-3.5" />ORBIT Payment · Transactions</p><h1 className="mt-3 text-[30px] font-semibold tracking-[-.055em] text-white sm:text-[38px]">Payments</h1><p className="mt-2 text-[11px] text-[#777d89]">A clear view of who paid, how they paid and whether the payment passed.</p></div><span className="inline-flex w-fit items-center gap-2 rounded-full border border-[#63caa5]/15 bg-[#63caa5]/[.05] px-3 py-2 text-[8px] text-[#82cdb2]"><ShieldCheck className="size-3.5" />Verified payment results</span></header>
    {!result.processorAvailable && <p className="mt-5 rounded-2xl border border-[#d4ae68]/15 bg-[#d4ae68]/[.055] px-4 py-3 text-[10px] leading-5 text-[#c7ad77]">Payment methods, processing fees and decline reasons will appear when the live ORBIT Payment connection is available. Recorded amounts remain visible.</p>}
    <section className="mt-7 overflow-hidden rounded-[24px] border border-white/[.075] bg-[#0b0d13] shadow-[0_25px_70px_rgba(0,0,0,.18)]"><PaymentFilters values={input} /><PaymentsTable payments={result.payments} emptyText="Payments will appear here as soon as matching transactions are processed." /><Pagination query={query} previousCursor={result.previousCursor} nextCursor={result.nextCursor} /></section>
  </div>;
}
