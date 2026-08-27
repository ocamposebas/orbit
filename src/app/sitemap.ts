import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";

const routes = ["", "/product", "/monitoring", "/solutions", "/custom-compliance", "/about", "/contact", "/privacy", "/terms", "/refund", "/login", "/request-access"];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({ url: `${siteConfig.url}${route}`, lastModified: new Date(), changeFrequency: route === "" ? "weekly" : "monthly", priority: route === "" ? 1 : route === "/login" ? .3 : .7 }));
}
