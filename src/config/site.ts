export const siteConfig = {
  companyName: "ORBIT",
  legalName: "[LEGAL ENTITY]",
  supportEmail: "[SUPPORT EMAIL]",
  salesEmail: "[SALES EMAIL]",
  address: "[BUSINESS ADDRESS]",
  domain: "orbit.example",
  url: "https://orbit.example",
  description: "Continuous merchant compliance monitoring, website risk intelligence, change detection, and audit-ready reporting for modern commerce.",
} as const;

export const primaryNav = [
  { label: "Product", href: "/product" },
  { label: "Solutions", href: "/solutions" },
  { label: "Monitoring", href: "/monitoring" },
  { label: "Company", href: "/about" },
] as const;
