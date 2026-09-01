import { Search } from "lucide-react";

export function PaymentFilters({ values }: { values: { query?: string; status?: string; range?: string; from?: string; to?: string } }) {
  return <form method="get" className="border-b border-[#e8e9ec] px-4 py-4 sm:px-6">
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
      <label className="relative min-w-0 flex-1"><span className="sr-only">Search payments</span><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#a0a4ac]" /><input name="query" defaultValue={values.query} placeholder="Search payment ID, order, email, last4 or PaymentIntent" className="h-10 w-full rounded-[10px] border border-[#dfe1e5] bg-[#fafbfc] pl-9 pr-3 text-[11px] text-[#35383e] outline-none transition placeholder:text-[#a5a9b0] focus:border-[#8d80e6] focus:bg-white focus:ring-2 focus:ring-[#7969e8]/10" /></label>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <label><span className="sr-only">Payment status</span><select name="status" defaultValue={values.status ?? "all"} className="h-10 w-full rounded-[10px] border border-[#dfe1e5] bg-white px-3 text-[10px] text-[#5c6068] outline-none focus:border-[#8d80e6]"><option value="all">All statuses</option><option value="succeeded">Succeeded</option><option value="pending">Pending</option><option value="failed">Failed</option><option value="refunded">Refunded</option><option value="partially_refunded">Partially refunded</option><option value="disputed">Disputed</option></select></label>
        <label><span className="sr-only">Date range</span><select name="range" defaultValue={values.range ?? "30d"} className="h-10 w-full rounded-[10px] border border-[#dfe1e5] bg-white px-3 text-[10px] text-[#5c6068] outline-none focus:border-[#8d80e6]"><option value="all">All time</option><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option><option value="custom">Custom range</option></select></label>
      </div>
      <div className="grid grid-cols-2 gap-2"><label className="flex h-10 items-center rounded-[10px] border border-[#dfe1e5] bg-white px-3 text-[9px] text-[#999da5]">From<input type="date" name="from" defaultValue={values.from} className="ml-2 min-w-0 bg-transparent text-[10px] text-[#5c6068] outline-none" /></label><label className="flex h-10 items-center rounded-[10px] border border-[#dfe1e5] bg-white px-3 text-[9px] text-[#999da5]">To<input type="date" name="to" defaultValue={values.to} className="ml-2 min-w-0 bg-transparent text-[10px] text-[#5c6068] outline-none" /></label></div>
      <button className="h-10 rounded-[10px] bg-[#26292f] px-5 text-[10px] font-semibold text-white transition hover:bg-[#17191e]">Apply filters</button>
    </div>
  </form>;
}

