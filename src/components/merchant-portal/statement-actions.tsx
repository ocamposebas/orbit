"use client";

import { useState, useTransition } from "react";
import { Mail, X } from "lucide-react";

export function StatementActions({ publicId, recipient, canEmail }: { publicId: string; recipient: string | null; canEmail: boolean }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!canEmail) return null;
  function send() {
    startTransition(async () => {
      const response = await fetch(`/api/portal/statements/${encodeURIComponent(publicId)}/email`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(body.error ?? "Unable to queue statement email."); return; }
      setOpen(false); setMessage("Statement email queued successfully.");
    });
  }
  return <>
    <button type="button" onClick={() => setOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[.1] bg-white/[.035] px-4 text-[10px] font-semibold text-[#d8dae0] hover:border-[#8f7dff]/40"><Mail className="size-3.5" />Email statement</button>
    {message && <div role="status" className="fixed bottom-5 right-5 z-[90] rounded-xl border border-[#65d1aa]/20 bg-[#101a18] px-4 py-3 text-[10px] text-[#8fdfc1] shadow-2xl">{message}</div>}
    {open && <div className="fixed inset-0 z-[85] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="email-statement-title"><div className="w-full max-w-md rounded-[22px] border border-white/[.1] bg-[#101218] p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-[#9c90f5]">Secure delivery</p><h2 id="email-statement-title" className="mt-2 text-xl font-semibold">Email statement</h2></div><button onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-lg text-[#777d89] hover:bg-white/[.05]" aria-label="Close"><X className="size-4" /></button></div><p className="mt-5 text-[11px] leading-6 text-[#8a909b]">Send this finalized statement to the merchant financial contact:</p><p className="mt-2 rounded-xl border border-white/[.07] bg-white/[.025] px-4 py-3 text-[11px] text-[#d7d9df]">{recipient ?? "No financial email is configured"}</p>{message && <p className="mt-3 text-[10px] text-[#e3ae78]">{message}</p>}<div className="mt-6 flex justify-end gap-2"><button onClick={() => setOpen(false)} className="h-10 rounded-xl px-4 text-[10px] text-[#8c929d]">Cancel</button><button disabled={!recipient || pending} onClick={send} className="h-10 rounded-xl bg-[#6f60e6] px-4 text-[10px] font-semibold text-white disabled:opacity-40">{pending ? "Queueing…" : "Send statement"}</button></div></div></div>}
  </>;
}
