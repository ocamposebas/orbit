"use client";

import { Activity, Building2, CreditCard, FileText, LoaderCircle, Search, ScanSearch, UsersRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { GlobalSearchResult } from "@/operations/search";

const icons = { customer: UsersRound, payment: CreditCard, statement: FileText, scan: ScanSearch, merchant: Building2 };

export function GlobalSearch() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen(true); }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => { if (open) window.setTimeout(() => input.current?.focus(), 30); }, [open]);
  useEffect(() => {
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/portal/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (response.ok) setResults((await response.json() as { results: GlobalSearchResult[] }).results);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 220);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query]);

  async function select(result: GlobalSearchResult) {
    if (result.merchantId) {
      const response = await fetch("/api/portal/merchant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ merchantId: result.merchantId }) });
      if (!response.ok) return;
    }
    setOpen(false); setQuery(""); setResults([]);
    router.push(result.href); router.refresh();
  }

  function updateQuery(value: string) {
    setQuery(value);
    if (value.trim().length < 2) { setResults([]); setLoading(false); }
  }

  return <>
    <button type="button" onClick={() => setOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-white/[.08] bg-white/[.025] px-3 text-[10px] text-[#858b96] transition hover:border-[#7868e8]/30 hover:text-white" aria-label="Open global search"><Search className="size-3.5" /><span className="hidden sm:inline">Search</span><kbd className="hidden rounded border border-white/[.08] px-1.5 py-0.5 text-[7px] text-[#626874] md:inline">Ctrl K</kbd></button>
    {open && <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/65 px-4 pt-[12vh] backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Global search" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="w-full max-w-2xl overflow-hidden rounded-[22px] border border-white/[.1] bg-[#0d0f16] shadow-[0_40px_120px_rgba(0,0,0,.55)]">
        <div className="flex h-14 items-center gap-3 border-b border-white/[.07] px-4"><Search className="size-4 text-[#9385ee]" /><input ref={input} value={query} onChange={(event) => updateQuery(event.target.value)} placeholder="Search customers, payments, statements, scans or brands" className="min-w-0 flex-1 bg-transparent text-[12px] text-white outline-none placeholder:text-[#555b67]" />{loading && <LoaderCircle className="size-3.5 animate-spin text-[#8f82ef]" />}<button type="button" onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-lg text-[#6f7580] hover:bg-white/[.05] hover:text-white" aria-label="Close search"><X className="size-4" /></button></div>
        <div className="max-h-[55vh] overflow-y-auto p-2">{query.trim().length < 2 ? <div className="px-5 py-12 text-center"><Activity className="mx-auto size-5 text-[#7868e8]" /><p className="mt-3 text-[11px] text-[#8a909a]">Type at least two characters to search the authorized workspace.</p></div> : !loading && !results.length ? <p className="px-5 py-12 text-center text-[11px] text-[#737985]">No matching records.</p> : results.map((result) => { const Icon = icons[result.kind]; return <button key={result.id} type="button" onClick={() => void select(result)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-[#8f7dff]/[.07]"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#8f7dff]/[.08] text-[#9c90ef]"><Icon className="size-3.5" /></span><span className="min-w-0"><span className="block truncate text-[11px] font-medium text-[#e0e2e7]">{result.label}</span><span className="mt-1 block truncate text-[8px] text-[#676d79]">{result.description}</span></span><span className="ml-auto text-[7px] uppercase tracking-[.1em] text-[#555b67]">{result.kind}</span></button>; })}</div>
      </div>
    </div>}
  </>;
}
