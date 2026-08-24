import * as cheerio from "cheerio";
import { safeFetchText } from "@/sentinel/security/ssrf";
import { complianceUrlPriority } from "@/sentinel/classification/policy-signals";

export interface RobotsPolicy {
  sitemaps: string[];
  disallowed: string[];
  isAllowed(url: string): boolean;
}

export function parseRobots(text: string, origin: string): RobotsPolicy {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/#.*$/, "").trim()).filter(Boolean);
  const sitemaps: string[] = [];
  const groups: Array<{ agents: string[]; rules: Array<{ path: string; allow: boolean }> }> = [];
  let group: { agents: string[]; rules: Array<{ path: string; allow: boolean }> } | undefined;
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.toLowerCase();
    const value = rest.join(":").trim();
    if (key === "sitemap" && value) { try { const url = new URL(value, origin); if (url.origin === origin) sitemaps.push(url.toString()); } catch { /* invalid sitemap URL */ } }
    else if (key === "user-agent") {
      if (!group || group.rules.length) { group = { agents: [], rules: [] }; groups.push(group); }
      group.agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && group && value) group.rules.push({ path: value.replace(/\$$/, ""), allow: key === "allow" });
  }
  const specific = groups.filter((item) => item.agents.some((agent) => agent.includes("orbit-sentinel")));
  const applicable = specific.length ? specific : groups.filter((item) => item.agents.includes("*"));
  const rules = applicable.flatMap((item) => item.rules);
  const disallowed = rules.filter((rule) => !rule.allow).map((rule) => rule.path);
  return { sitemaps: [...new Set(sitemaps)], disallowed, isAllowed(url) {
    const path = `${new URL(url).pathname}${new URL(url).search}`;
    const matches = rules.filter((rule) => rule.path === "/" || path.startsWith(rule.path)).sort((left, right) => right.path.length - left.path.length || Number(right.allow) - Number(left.allow));
    return matches[0]?.allow ?? true;
  } };
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
      const nested = $("sitemap > loc").map((_, node) => $(node).text().trim()).get().filter((value) => { try { return new URL(value, origin).origin === origin; } catch { return false; } }).slice(0, 20);
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
  const urls = [target.toString(), ...batches.flat()]
    .filter((url, index, all) => all.indexOf(url) === index && robots.isAllowed(url))
    .sort((left, right) => complianceUrlPriority(left) - complianceUrlPriority(right))
    .slice(0, maximum);
  return { robots, urls };
}
