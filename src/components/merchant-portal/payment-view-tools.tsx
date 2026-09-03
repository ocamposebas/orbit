"use client";

import { Bookmark, Download, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type SavedView = { name: string; query: string };
const storageKey = "orbit.payment.saved-views.v1";

export function PaymentViewTools() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [views, setViews] = useState<SavedView[]>([]);
  useEffect(() => {
    const timer = window.setTimeout(() => { try { setViews(JSON.parse(localStorage.getItem(storageKey) ?? "[]") as SavedView[]); } catch { setViews([]); } }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const currentQuery = searchParams.toString();
  function save() {
    const suggested = `Payments ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    const name = window.prompt("Name this payment view", suggested)?.trim().slice(0, 40);
    if (!name) return;
    const next = [{ name, query: currentQuery }, ...views.filter((view) => view.name !== name)].slice(0, 8);
    localStorage.setItem(storageKey, JSON.stringify(next)); setViews(next);
  }
  function remove(name: string) { const next = views.filter((view) => view.name !== name); localStorage.setItem(storageKey, JSON.stringify(next)); setViews(next); }
  return <div className="flex flex-wrap items-center gap-2 border-b border-white/[.06] px-4 py-3 sm:px-6"><button type="button" onClick={save} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[.08] px-3 text-[8px] font-semibold text-[#a9aeb8]"><Bookmark className="size-3" />Save view</button><Link href={`/api/portal/payments/export${currentQuery ? `?${currentQuery}` : ""}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[.08] px-3 text-[8px] font-semibold text-[#a9aeb8]"><Download className="size-3" />Export CSV</Link>{views.map((view) => <span key={view.name} className="inline-flex h-8 items-center rounded-lg bg-[#8f7dff]/[.07] pl-3 text-[8px] text-[#b1a7fa]"><Link href={`${pathname}${view.query ? `?${view.query}` : ""}`}>{view.name}</Link><button type="button" onClick={() => remove(view.name)} className="grid h-8 w-7 place-items-center text-[#666c78] hover:text-white" aria-label={`Delete saved view ${view.name}`}><Trash2 className="size-3" /></button></span>)}</div>;
}
