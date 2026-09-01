"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1_800); }} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#e0e2e6] bg-white px-2.5 text-[9px] font-medium text-[#737780] transition hover:border-[#cfd1d6] hover:text-[#34373d]" aria-label={`${label}: ${value}`}>{copied ? <Check className="size-3 text-[#4a9a79]" /> : <Copy className="size-3" />}{copied ? "Copied" : label}</button>;
}

