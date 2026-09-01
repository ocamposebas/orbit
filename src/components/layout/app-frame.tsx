"use client";

import { usePathname } from "next/navigation";
import { Navbar } from "./navbar";
import { Footer } from "./footer";

export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const standalone = pathname.startsWith("/sentinel") || pathname.startsWith("/dashboard") || pathname.startsWith("/portal-access") || pathname.startsWith("/onboarding/") || pathname.startsWith("/pay/");
  if (standalone) return <main id="main-content">{children}</main>;
  return <><Navbar /><main id="main-content">{children}</main><Footer /></>;
}
