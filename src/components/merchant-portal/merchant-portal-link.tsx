"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function MerchantPortalLink({ merchantId, href, className, children, ariaLabel }: { merchantId: string; href: string; className?: string; children: ReactNode; ariaLabel?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return <button type="button" aria-label={ariaLabel} disabled={loading} className={cn("text-left disabled:opacity-60", className)} onClick={async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/portal/merchant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ merchantId }) });
      if (!response.ok) throw new Error("Unable to open merchant");
      router.push(href);
      router.refresh();
    } finally { setLoading(false); }
  }}>{children}</button>;
}
