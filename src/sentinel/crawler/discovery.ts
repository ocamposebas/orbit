import * as cheerio from "cheerio";
import { safeFetchText } from "@/sentinel/security/ssrf";

export interface RobotsPolicy {
  sitemaps: string[];
  disallowed: string[];
  isAllowed(url: string): boolean;
}

export function parseRobots(text: string, origin: string): RobotsPolicy {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/#.*$/, "").trim()).filter(Boolean);
  const sitemaps: string[] = [];
  const disallowed: string[] = [];
  let applies = false;
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") applies = value === "*" || value.toLowerCase().includes("orbit-sentinel");
    else if (key === "sitemap" && value) { try { sitemaps.push(new URL(value, origin).toString()); } catch { /* invalid sitemap URL */ } }
    else if (key === "disallow" && applies && value) disallowed.push(value);
    else if (key === "allow" && applies && value) {
      const index = disallowed.indexOf(value);
      if (index >= 0) disallowed.splice(index, 1);
    }
  }
  return { sitemaps: [...new Set(sitemaps)], disallowed, isAllowed(url) { const path = new URL(url).pathname; return !disallowed.some((rule) => rule !== "/" && path.startsWith(rule)) && !disallowed.includes("/"); } };
}

export async function loadRobots(origin: string): Promise<RobotsPolicy> {
  try {
    const response = await safeFetchText(new URL("/robots.txt", origin), { maxBytes: 250_000, accept: "text/plain" });
    if (response.status >= 400) return parseRobots("", origin);
    return parseRobots(response.text, origin);
  } catch { return parseRobots("", origin); }
}

async function sitemapUrls(sitemapUrl: string, origin: string, remaining = 5): Promise<string[]> {
  if (remaining <= 0) return [];
  try {
    const response = await safeFetchText(sitemapUrl, { maxBytes: 3_000_000, accept: "application/xml,text/xml,text/plain" });
    if (response.status >= 400) return [];
    const $ = cheerio.load(response.text, { xmlMode: true });
    if ($("sitemapindex").length) {
      const nested = $("sitemap > loc").map((_, node) => $(node).text().trim()).get().slice(0, 20);
      const batches = await Promise.all(nested.map((url) => sitemapUrls(url, origin, remaining - 1)));
      return batches.flat();
    }
    return $("url > loc").map((_, node) => $(node).text().trim()).get().filter((value) => {
      try { return new URL(value).origin === origin; } catch { return false; }
    });
  } catch { return []; }
}

export async function discoverSeedUrls(target: URL, maximum: number) {
  const robots = await loadRobots(target.origin);
  const sitemapCandidates = robots.sitemaps.length ? robots.sitemaps : [new URL("/sitemap.xml", target).toString()];
  const batches = await Promise.all(sitemapCandidates.slice(0, 10).map((url) => sitemapUrls(url, target.origin)));
  const urls = [target.toString(), ...batches.flat()].filter((url, index, all) => all.indexOf(url) === index && robots.isAllowed(url)).slice(0, maximum);
  return { robots, urls };
}
