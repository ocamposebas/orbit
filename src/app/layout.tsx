import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppFrame } from "@/components/layout/app-frame";
import { siteConfig } from "@/config/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: { default: "ORBIT - Continuous Merchant Risk Intelligence", template: "%s - ORBIT" },
  description: siteConfig.description,
  applicationName: "ORBIT",
  keywords: ["merchant compliance", "risk intelligence", "website monitoring", "change detection", "audit trail", "merchant risk"],
  authors: [{ name: "ORBIT" }],
  openGraph: { type: "website", locale: "en_US", url: siteConfig.url, siteName: "ORBIT", title: "ORBIT - Continuous Merchant Risk Intelligence", description: siteConfig.description },
  twitter: { card: "summary_large_image", title: "ORBIT - Continuous Merchant Risk Intelligence", description: siteConfig.description },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#050611", colorScheme: "dark", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <a href="#main-content" className="fixed left-4 top-3 z-[100] -translate-y-20 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black focus:translate-y-0">Skip to content</a>
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
