import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { classifyPage } from "@/sentinel/classification/classifier";
import { extractNormalizedContent } from "@/sentinel/extraction/extract";
import { contentHash } from "@/sentinel/extraction/normalize";
import { getServerEnv } from "@/sentinel/config";
import { normalizePublicUrl, validatePublicUrl } from "@/sentinel/security/ssrf";
import type { ClassifiedPage, NormalizedContent } from "@/sentinel/types";
import { discoverSeedUrls, parseRobots, type RobotsPolicy } from "./discovery";

export interface CrawledPage {
  url: string;
  canonicalUrl?: string;
  discoveredFrom?: string;
  depth: number;
  status?: number;
  contentType?: string;
  title?: string;
  description?: string;
  robots?: string;
  normalized?: NormalizedContent;
  classification?: ClassifiedPage;
  hash?: string;
  inaccessibleReason?: string;
}

export interface CrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  concurrency?: number;
  onProgress?: (event: { processed: number; total: number; currentUrl: string }) => Promise<void> | void;
  onPage?: (page: CrawledPage, event: { processed: number; total: number; recovered: boolean }) => Promise<void> | void;
  resumePages?: ReadonlyMap<string, CrawledPage>;
  unsafeAllowPrivateTestTarget?: boolean;
}

function canonicalize(input: string, base: string): string | null {
  try {
    const url = new URL(input, base);
    if (!new Set(["http:", "https:"]).has(url.protocol)) return null;
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|gclid|fbclid|ref$)/i.test(key)) url.searchParams.delete(key);
    url.hash = "";
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch { return null; }
}

async function secureContext(browser: Browser, unsafeAllowPrivateTestTarget = false): Promise<BrowserContext> {
  const env = getServerEnv();
  const context = await browser.newContext({ serviceWorkers: "block", userAgent: "ORBIT-Sentinel/1.0 (+website-monitoring)", viewport: { width: 1440, height: 1000 }, javaScriptEnabled: true });
  await context.route("**/*", async (route) => {
    const requestUrl = route.request().url();
    if (/^(data|blob|about):/.test(requestUrl)) return route.continue();
    try { if (!unsafeAllowPrivateTestTarget) await validatePublicUrl(requestUrl); await route.continue(); }
    catch { await route.abort("blockedbyclient"); }
  });
  context.setDefaultNavigationTimeout(env.CRAWLER_NAVIGATION_TIMEOUT_MS);
  return context;
}

async function crawlOne(page: Page, url: string, depth: number, discoveredFrom?: string, unsafeAllowPrivateTestTarget = false): Promise<CrawledPage> {
  const env = getServerEnv();
  try {
    let response = await page.goto(url, { waitUntil: "domcontentloaded" });
    if (response && (response.status() === 429 || response.status() >= 500)) {
      const retryAfter = Number(response.headers()["retry-after"] ?? 1);
      await page.waitForTimeout(Math.min(5_000, Math.max(250, retryAfter * 1_000)));
      response = await page.goto(url, { waitUntil: "domcontentloaded" });
    }
    await page.waitForLoadState("networkidle", { timeout: 2_500 }).catch(() => undefined);
    const redirects: string[] = [];
    let request = response?.request() ?? null;
    while (request?.redirectedFrom()) { redirects.push(request.url()); request = request.redirectedFrom(); }
    if (redirects.length > 4) throw new Error("Redirect limit exceeded");
    const html = await page.content();
    if (Buffer.byteLength(html) > env.CRAWLER_RESPONSE_LIMIT_BYTES) throw new Error("Rendered page exceeds the configured size limit");
    const finalUrl = page.url();
    if (!unsafeAllowPrivateTestTarget) await validatePublicUrl(finalUrl);
    const metadata = await page.evaluate(() => ({ canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href, description: document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content, robots: document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content }));
    const normalized = extractNormalizedContent(html, finalUrl);
    const classification = classifyPage(finalUrl, normalized);
    return { url: finalUrl, canonicalUrl: metadata.canonical, discoveredFrom, depth, status: response?.status(), contentType: response?.headers()["content-type"], title: normalized.title, description: metadata.description, robots: metadata.robots, normalized, classification, hash: contentHash(normalized) };
  } catch (error) {
    return { url, discoveredFrom, depth, inaccessibleReason: error instanceof Error ? error.message.slice(0, 500) : "Unknown crawl error" };
  }
}

async function crawlWithRecovery(page: Page, url: string, depth: number, discoveredFrom?: string, unsafeAllowPrivateTestTarget = false) {
  let result: CrawledPage = { url, depth, discoveredFrom, inaccessibleReason: "Page was not attempted" };
  for (let attempt = 1; attempt <= 3; attempt++) {
    result = await crawlOne(page, url, depth, discoveredFrom, unsafeAllowPrivateTestTarget);
    if (!result.inaccessibleReason || attempt === 3) return result;
    await page.waitForTimeout(attempt * 350);
  }
  return result;
}

function internalLinks(page: CrawledPage, origin: string, robots: RobotsPolicy): string[] {
  return page.normalized?.links.map((link) => canonicalize(link.href, page.url)).filter((url): url is string => Boolean(url)).filter((url) => new URL(url).origin === origin && robots.isAllowed(url)) ?? [];
}

export async function crawlSite(targetInput: string, options: CrawlOptions = {}): Promise<CrawledPage[]> {
  const env = getServerEnv();
  const testOverride = options.unsafeAllowPrivateTestTarget === true;
  if (testOverride && process.env.NODE_ENV !== "test") throw new Error("Private target override is available only to automated tests");
  const target = testOverride ? new URL(targetInput) : await validatePublicUrl(normalizePublicUrl(targetInput));
  const maxPages = Math.min(options.maxPages ?? env.CRAWLER_MAX_PAGES, 1_000);
  const maxDepth = Math.min(options.maxDepth ?? env.CRAWLER_MAX_DEPTH, 10);
  const concurrency = Math.min(options.concurrency ?? env.CRAWLER_CONCURRENCY, 8);
  const discovery = testOverride ? { robots: parseRobots("", target.origin), urls: [target.toString()] } : await discoverSeedUrls(target, maxPages);
  const queue = discovery.urls.map((url) => ({ url: canonicalize(url, target.toString())!, depth: 0, from: undefined as string | undefined }));
  const seen = new Set(queue.map((item) => item.url));
  const resultUrls = new Set<string>();
  const results: CrawledPage[] = [];
  const browser = await chromium.launch({ headless: true });
  const context = await secureContext(browser, testOverride);
  try {
    while (queue.length && results.length < maxPages) {
      const batch = queue.splice(0, Math.min(concurrency, maxPages - results.length));
      const pages = await Promise.all(batch.map(async (item) => {
        const recovered = options.resumePages?.get(item.url);
        if (recovered) return { crawled: recovered, recovered: true };
        const tab = await context.newPage();
        try { return { crawled: await crawlWithRecovery(tab, item.url, item.depth, item.from, testOverride), recovered: false }; }
        finally { await tab.close(); }
      }));
      for (const item of pages) {
        const { crawled } = item;
        const resultKey = canonicalize(crawled.url, target.toString()) ?? crawled.url;
        if (resultUrls.has(resultKey)) continue;
        resultUrls.add(resultKey);
        results.push(crawled);
        await options.onPage?.(crawled, { processed: results.length, total: Math.min(maxPages, results.length + queue.length), recovered: item.recovered });
        await options.onProgress?.({ processed: results.length, total: Math.min(maxPages, results.length + queue.length), currentUrl: crawled.url });
        if (crawled.depth >= maxDepth) continue;
        for (const url of internalLinks(crawled, target.origin, discovery.robots)) if (!seen.has(url) && seen.size < maxPages) { seen.add(url); queue.push({ url, depth: crawled.depth + 1, from: crawled.url }); }
      }
      if (queue.length) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return results;
  } finally { await context.close(); await browser.close(); }
}
