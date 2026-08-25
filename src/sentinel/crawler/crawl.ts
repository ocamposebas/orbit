import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { classifyPage } from "@/sentinel/classification/classifier";
import { extractNormalizedContent } from "@/sentinel/extraction/extract";
import { contentHash } from "@/sentinel/extraction/normalize";
import { getServerEnv } from "@/sentinel/config";
import { normalizePublicUrl, validatePublicUrl } from "@/sentinel/security/ssrf";
import type { ClassifiedPage, NormalizedContent } from "@/sentinel/types";
import { discoverSeedUrls, parseRobots, type RobotsPolicy } from "./discovery";
import { complianceUrlPriority } from "@/sentinel/classification/policy-signals";

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

const mutatingPath = /\/(?:logout|log-out|signout|sign-out|(?:api\/)?(?:account\/)?(?:delete|destroy|unsubscribe|revoke|disconnect)|(?:cart|basket|wishlist|favorites?)\/(?:add|change|update|remove|delete|clear))(?:\/|$)/i;
const mutatingQuery = /^(?:add-to-cart|remove_item|wc-ajax|action|mutation|_method|command|cmd)$/i;

export function isReadOnlyRequest(method: string, input: string) {
  if (!new Set(["GET", "HEAD"]).has(method.toUpperCase())) return false;
  try {
    const url = new URL(input);
    if (mutatingPath.test(url.pathname)) return false;
    if ([...url.searchParams.keys()].some((key) => mutatingQuery.test(key))) return false;
    return true;
  } catch { return false; }
}

async function secureContext(browser: Browser, unsafeAllowPrivateTestTarget = false): Promise<BrowserContext> {
  const env = getServerEnv();
  const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false, userAgent: "ORBIT-Sentinel/1.1 (+read-only-website-monitoring)", extraHTTPHeaders: { DNT: "1", "Sec-GPC": "1" }, viewport: { width: 1440, height: 1000 }, javaScriptEnabled: true });
  await context.addInitScript(() => {
    const prevent = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
    window.addEventListener("submit", prevent, true);
    HTMLFormElement.prototype.submit = function readOnlySubmit() { /* ORBIT never submits forms */ };
    HTMLFormElement.prototype.requestSubmit = function readOnlyRequestSubmit() { /* ORBIT never submits forms */ };
    Navigator.prototype.sendBeacon = function readOnlyBeacon() { return false; };
    window.open = () => null;
  });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const requestUrl = route.request().url();
    if (!isReadOnlyRequest(request.method(), requestUrl)) return route.abort("blockedbyclient");
    if (["websocket", "eventsource"].includes(request.resourceType())) return route.abort("blockedbyclient");
    if (/^(data|blob|about):/.test(requestUrl)) return route.continue();
    try { if (!unsafeAllowPrivateTestTarget) await validatePublicUrl(requestUrl); await route.continue(); }
    catch { await route.abort("blockedbyclient"); }
  });
  context.setDefaultNavigationTimeout(env.CRAWLER_NAVIGATION_TIMEOUT_MS);
  return context;
}

const prohibitedInteractiveLabel = /(?:accept|agree|consent|place order|pay|purchase|subscribe|submit|send|book|schedule|delete|remove|logout|sign out)/i;
const safeInteractiveLabel = /(?:menu|navigation|details|more info|description|ingredients|faq|question|accordion|expand|view more|read more|specification|certificate|lab result|research information)/i;

export async function inspectSafeInteractiveStates(page: Page) {
  const observed: Array<{ kind: string; label: string; selector: string }> = [];
  await page.locator("details:not([open])").evaluateAll((elements) => elements.slice(0, 20).forEach((element) => element.setAttribute("open", ""))).catch(() => undefined);
  const candidates = page.locator("button[aria-expanded='false'],[role='button'][aria-expanded='false'],[role='tab'][aria-selected='false']");
  for (let index = 0; index < Math.min(await candidates.count().catch(() => 0), 20); index++) {
    const item = candidates.nth(index);
    const label = ((await item.getAttribute("aria-label").catch(() => null)) || (await item.innerText().catch(() => ""))).replace(/\s+/g, " ").trim().slice(0, 200);
    if (!label || prohibitedInteractiveLabel.test(label) || !safeInteractiveLabel.test(label)) continue;
    const selector = await item.evaluate((element) => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute("role");
      const expanded = element.getAttribute("aria-expanded");
      return `${tag}${role ? `[role="${role}"]` : ""}${expanded ? `[aria-expanded="${expanded}"]` : ""}`;
    }).catch(() => "[interactive-control]");
    await item.click({ timeout: 1_500 }).catch(() => undefined);
    observed.push({ kind: "expanded-control", label, selector });
  }
  const selects = page.locator("select[name*='variant' i],select[name*='option' i],select[id*='variant' i]");
  for (let index = 0; index < Math.min(await selects.count().catch(() => 0), 8); index++) {
    const select = selects.nth(index);
    const options = await select.locator("option:not([disabled])").evaluateAll((items) => items.map((item) => ({ value: (item as HTMLOptionElement).value, label: (item.textContent || "").trim() }))).catch(() => [] as Array<{ value: string; label: string }>);
    for (const option of options.slice(0, 12)) if (option.value) observed.push({ kind: "product-variation", label: option.label, selector: await select.evaluate((element) => element.id ? `#${CSS.escape(element.id)}` : element.tagName.toLowerCase()).catch(() => "select") });
  }
  return observed;
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
    const interactiveStates = await inspectSafeInteractiveStates(page);
    const redirects: string[] = [];
    let request = response?.request() ?? null;
    while (request?.redirectedFrom()) { redirects.push(request.url()); request = request.redirectedFrom(); }
    if (redirects.length > 4) throw new Error("Redirect limit exceeded");
    const contentType = response?.headers()["content-type"] ?? "";
    if (contentType && !/(?:text\/html|application\/xhtml\+xml)/i.test(contentType)) return { url: page.url(), discoveredFrom, depth, status: response?.status(), contentType, inaccessibleReason: "Non-HTML response was not analyzed" };
    const html = await page.content();
    if (Buffer.byteLength(html) > env.CRAWLER_RESPONSE_LIMIT_BYTES) throw new Error("Rendered page exceeds the configured size limit");
    const finalUrl = page.url();
    if (!unsafeAllowPrivateTestTarget) await validatePublicUrl(finalUrl);
    const metadata = await page.evaluate(() => ({ canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href, description: document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content, robots: document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content }));
    const renderedVisibleText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    const normalized = extractNormalizedContent(html, finalUrl, { originalUrl: url, renderedVisibleText, interactiveStates });
    const soft404Structure = `${normalized.title} ${normalized.headings.slice(0, 2).join(" ")}`.trim();
    if (/\b(?:404|page not found|not found|page does not exist|nothing here)\b/i.test(soft404Structure) && soft404Structure.length < 300) return { url: finalUrl, canonicalUrl: metadata.canonical, discoveredFrom, depth, status: response?.status(), contentType, title: normalized.title, description: metadata.description, robots: metadata.robots, inaccessibleReason: "Soft 404 page was not analyzed" };
    const classification = classifyPage(finalUrl, normalized);
    return { url: finalUrl, canonicalUrl: metadata.canonical, discoveredFrom, depth, status: response?.status(), contentType, title: normalized.title, description: metadata.description, robots: metadata.robots, normalized, classification, hash: contentHash(normalized) };
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
  return page.normalized?.links.map((link) => canonicalize(link.href, page.url)).filter((url): url is string => Boolean(url)).filter((url) => new URL(url).origin === origin && robots.isAllowed(url)).sort((left, right) => complianceUrlPriority(left) - complianceUrlPriority(right)) ?? [];
}

export async function crawlSite(targetInput: string, options: CrawlOptions = {}): Promise<CrawledPage[]> {
  const env = getServerEnv();
  const testOverride = options.unsafeAllowPrivateTestTarget === true;
  if (testOverride && process.env.NODE_ENV !== "test") throw new Error("Private target override is available only to automated tests");
  const target = testOverride ? new URL(targetInput) : await validatePublicUrl(normalizePublicUrl(targetInput));
  const maxPages = Math.min(options.maxPages ?? env.CRAWLER_MAX_PAGES, 1_000);
  const maxDepth = Math.min(options.maxDepth ?? env.CRAWLER_MAX_DEPTH, 10);
  const concurrency = Math.min(options.concurrency ?? env.CRAWLER_CONCURRENCY, 8);
  const reservedForNavigation = Math.min(30, Math.max(8, Math.ceil(maxPages * 0.2)));
  const seedBudget = Math.max(1, maxPages - reservedForNavigation);
  const discovery = testOverride ? { robots: parseRobots("", target.origin), urls: [target.toString()] } : await discoverSeedUrls(target, seedBudget);
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
