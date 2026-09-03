"use client";

import { useState } from "react";
import { formatMoney } from "@/merchant-portal/format";

export function AnalyticsChart({ points, currency }: { points: Array<{ day: Date; amountMinor: number; payments: number }>; currency: string }) {
  const [active, setActive] = useState<number | null>(null);
  const maximum = Math.max(...points.map((point) => point.amountMinor), 1);
  return <div className="mt-7"><div className="flex h-64 items-end gap-1.5" onMouseLeave={() => setActive(null)}>{points.length ? points.map((point, index) => <div key={`${point.day}-${index}`} className="group relative flex h-full min-w-0 flex-1 items-end" onMouseEnter={() => setActive(index)}><div className="w-full rounded-t-[4px] bg-gradient-to-t from-[#6755dd] to-[#a493ff] opacity-75 transition group-hover:opacity-100" style={{ height: `${Math.max(3, (point.amountMinor / maximum) * 100)}%` }} />{active === index && <div className="absolute left-1/2 top-1 z-10 min-w-36 -translate-x-1/2 rounded-xl border border-white/[.1] bg-[#191b24] px-3 py-2.5 text-center shadow-xl"><p className="text-[8px] text-[#7e8490]">{new Date(point.day).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</p><p className="mt-1 text-[11px] font-semibold text-white">{formatMoney(point.amountMinor, currency)}</p><p className="mt-1 text-[8px] text-[#777d89]">{point.payments} payments</p></div>}</div>) : <div className="grid h-full w-full place-items-center text-[10px] text-[#666c78]">No successful payment volume in this period.</div>}</div><div className="mt-3 flex justify-between text-[8px] text-[#5d636f]"><span>{points[0] ? new Date(points[0].day).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "—"}</span><span>Successful volume · {currency}</span><span>{points.at(-1) ? new Date(points.at(-1)!.day).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "—"}</span></div></div>;
}
