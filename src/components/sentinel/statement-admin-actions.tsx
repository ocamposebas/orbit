"use client";
import { useState, useTransition } from "react";

export function StatementAdminActions({ statementId, canAct }: { statementId: string; canAct: boolean }) {
  const [message, setMessage] = useState(""); const [pending, startTransition] = useTransition();
  if (!canAct) return null;
  const run = (action: "email" | "pdf") => startTransition(async () => { const response = await fetch(`/api/internal/statements/${statementId}/${action}`, { method: "POST" }); setMessage(response.ok ? action === "email" ? "Email queued" : "PDF regenerated" : "Action failed"); });
  return <div className="flex items-center gap-2"><button disabled={pending} onClick={() => run("email")} className="text-[9px] text-[#aaa1f5]">Retry email</button><button disabled={pending} onClick={() => run("pdf")} className="text-[9px] text-[#aaa1f5]">Rebuild PDF</button>{message && <span className="text-[8px] text-[#6fcfae]">{message}</span>}</div>;
}
