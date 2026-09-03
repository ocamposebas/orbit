"use client";
import { useState, useTransition } from "react";

export function StatementPreference({ initialValue, disabled }: { initialValue: boolean; disabled: boolean }) {
  const [enabled, setEnabled] = useState(initialValue); const [pending, startTransition] = useTransition(); const [message, setMessage] = useState<string | null>(null);
  function change(next: boolean) { const previous = enabled; setEnabled(next); startTransition(async () => { const response = await fetch("/api/portal/statements/preferences", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ monthlyStatementEmailEnabled: next }) }); if (!response.ok) { setEnabled(previous); setMessage("Could not save preference."); } else setMessage("Preference saved."); }); }
  return <div><label className="flex items-start gap-3"><input type="checkbox" checked={enabled} disabled={disabled || pending} onChange={(event) => change(event.target.checked)} className="mt-0.5 size-4 accent-[#7868e8]" /><span><span className="block text-[11px] font-medium text-[#dfe1e6]">Monthly statement ready</span><span className="mt-1 block text-[9px] leading-4 text-[#727884]">Email the merchant financial contact when a monthly statement is finalized.</span></span></label>{message && <p role="status" className="mt-3 text-[9px] text-[#8ed9bd]">{message}</p>}</div>;
}
