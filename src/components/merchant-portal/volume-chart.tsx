"use client";

import { useMemo, useState } from "react";
import type { VolumePoint } from "@/merchant-portal/data";
import { formatMoney } from "@/merchant-portal/format";
import { cn } from "@/lib/utils";

const ranges = [7, 30, 90] as const;

export function VolumeChart({ data, currency }: { data: VolumePoint[]; currency: string }) {
  const [range, setRange] = useState<(typeof ranges)[number]>(30);
  const [active, setActive] = useState<number | null>(null);
  const points = useMemo(() => data.slice(-range), [data, range]);
  const maximum = Math.max(...points.map((point) => point.amountMinor), 1);
  const width = 900;
  const height = 260;
  const coords = points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? width / 2 : (index / (points.length - 1)) * width,
    y: height - (point.amountMinor / maximum) * (height - 28) - 10,
  }));
  const path = coords.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  const area = `${path} L${width},${height} L0,${height} Z`;
  const selected = active === null ? null : coords[active];

  return <section className="rounded-[22px] border border-[#e1e3e7] bg-white p-5 shadow-[0_12px_40px_rgba(29,34,44,.045)] sm:p-7">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#9a9ea6]">Payment volume</p><h2 className="mt-2 text-[18px] font-semibold tracking-[-.035em] text-[#202329]">Daily sales activity</h2></div><div className="flex self-start rounded-[10px] bg-[#f1f2f4] p-1">{ranges.map((value) => <button key={value} onClick={() => { setRange(value); setActive(null); }} className={cn("h-7 rounded-[7px] px-3 text-[10px] font-semibold transition", range === value ? "bg-white text-[#3e354f] shadow-sm" : "text-[#8b8f97]")}>{value}D</button>)}</div></div>
    <div className="relative mt-7 h-[260px] w-full select-none" onMouseLeave={() => setActive(null)}>
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between"><span className="border-t border-dashed border-[#e5e7eb]" /><span className="border-t border-dashed border-[#e5e7eb]" /><span className="border-t border-dashed border-[#e5e7eb]" /><span className="border-t border-[#eceef0]" /></div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="relative h-full w-full overflow-visible" role="img" aria-label={`Payment volume for the last ${range} days`}>
        <defs><linearGradient id="portal-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7968eb" stopOpacity=".24" /><stop offset="100%" stopColor="#7968eb" stopOpacity="0" /></linearGradient></defs>
        <path d={area} fill="url(#portal-chart-fill)" />
        <path d={path} fill="none" stroke="#7564e8" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
        {coords.map((point, index) => <rect key={point.date} x={Math.max(0, point.x - width / points.length / 2)} y="0" width={Math.max(10, width / points.length)} height={height} fill="transparent" onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} tabIndex={0} aria-label={`${point.date}: ${formatMoney(point.amountMinor, currency)}, ${point.payments} payments`} />)}
        {selected && <><line x1={selected.x} x2={selected.x} y1="5" y2={height} stroke="#aaa1eb" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" /><circle cx={selected.x} cy={selected.y} r="5" fill="white" stroke="#6e5cdf" strokeWidth="3" vectorEffect="non-scaling-stroke" /></>}
      </svg>
      {selected && <div className="pointer-events-none absolute z-10 min-w-36 -translate-x-1/2 -translate-y-full rounded-xl border border-[#dedfe6] bg-[#1e2026] px-3.5 py-3 text-white shadow-xl" style={{ left: `${(selected.x / width) * 100}%`, top: `${Math.max(18, (selected.y / height) * 100)}%` }}><p className="text-[9px] text-[#aeb1ba]">{new Date(`${selected.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</p><p className="mt-1 text-[12px] font-semibold tabular-nums">{formatMoney(selected.amountMinor, currency)}</p><p className="mt-1 text-[9px] text-[#aeb1ba]">{selected.payments} payment{selected.payments === 1 ? "" : "s"}</p></div>}
    </div>
    <div className="mt-3 flex items-center justify-between text-[9px] text-[#a0a4ab]"><span>{new Date(`${points[0]?.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</span><span>Amounts shown in {currency.toUpperCase()}</span><span>{new Date(`${points.at(-1)?.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</span></div>
  </section>;
}

