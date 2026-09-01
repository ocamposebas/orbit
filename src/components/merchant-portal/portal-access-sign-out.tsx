"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

export function PortalAccessSignOut() {
  const router = useRouter();
  return <button onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }} className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#dfe1e5] px-4 text-[10px] font-medium text-[#62666e]"><LogOut className="size-3.5" />Sign out</button>;
}

