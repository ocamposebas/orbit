"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1_800); }} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[.08] bg-white/[.025] px-2.5 text-[9px] font-medium text-[#858b96] transition hover:border-[#8f7dff]/35 hover:bg-[#8f7dff]/[.07] hover:text-white" aria-label={`${label}: ${value}`}>{copied ? <Check className="size-3 text-[#65d1aa]" /> : <Copy className="size-3" />}{copied ? "Copied" : label}</button>;
}
