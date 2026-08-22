"use client";

import { usePathname } from "next/navigation";
import { Navbar } from "./navbar";
import { Footer } from "./footer";

export function AppFrame({ children }: { children: React.ReactNode }) {
  const sentinel = usePathname().startsWith("/sentinel");
  if (sentinel) return <main id="main-content">{children}</main>;
  return <><Navbar /><main id="main-content">{children}</main><Footer /></>;
}
