import { createHash } from "node:crypto";
import type { Browser, BrowserContext, Locator, Page } from "playwright";
import { chromium } from "playwright";
import type { Prisma } from "@/generated/prisma/client";
import { getDatabase } from "@/sentinel/db";
import { getServerEnv } from "@/sentinel/config";
import { logger, sanitizeLogText, serializeErrorForLog } from "@/sentinel/logger";
import { evidenceStorage } from "@/sentinel/storage";
import { normalizePublicUrl, safeFetchBinary, safeFetchText, validatePublicUrl } from "@/sentinel/security/ssrf";
import type { AuditBudget, AuditCoverage, AuditUsage, ToolExecutionResult } from "../types";
import { aiScannerToolNames } from "./definitions";

type EvidenceKind =
  | "PAGE_SNAPSHOT" | "VISIBLE_TEXT" | "DOM" | "LINK" | "METADATA" | "STRUCTURED_DATA"
  | "SCREENSHOT" | "VISUAL_REGION" | "IMAGE" | "BACKGROUND_IMAGE" | "CAROUSEL" | "PDF"
  | "PUBLIC_API" | "CHECKOUT_STATE" | "PRODUCT_FACT" | "CATEGORY_FACT";

type RetainEvidenceInput = {
  toolName: string;
  kind: EvidenceKind;
  sourceUrl: string;
  destinationUrl?: string;
  exactText?: string;
  surroundingDom?: unknown;
  bytes?: Uint8Array;
  mimeType?: string;
  metadata?: Record<string, unknown>;
};

type CoverageState = {
  urlsDiscovered: Set<string>;
  pagesOpened: Set<string>;
  pagesVisuallyReviewed: Set<string>;
  visualRegionsInspected: number;
  imagesInspected: number;
  categoriesInspected: Set<string>;
  productsDiscovered: Set<string>;
  productsVerified: number;
  documentsInspected: Set<string>;
  checkoutStatesInspected: Set<string>;
  totalLunaToolCalls: number;
};

type ImageInput = { evidenceId: string; mimeType: string; dataUrl: string };

const EMPTY_USAGE: AuditUsage = { responseCalls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0, approximateCostUsd: 0 };
const textLimit = (value: string, maximum = 50_000) => value.length > maximum ? `${value.slice(0, maximum)}…[truncated]` : value;
const json = (value: unknown) => value as Prisma.InputJsonValue;

export function safeNavigationCandidates(input: string) {
  const requested = normalizePublicUrl(input);
  const counterpartHost = requested.hostname.startsWith("www.") ? requested.hostname.slice(4) : `www.${requested.hostname}`;
  const protocols: Array<"http:" | "https:"> = requested.protocol === "https:" ? ["https:", "http:"] : ["http:", "https:"];
  const candidates: string[] = [];
  for (const protocol of protocols) {
    for (const hostname of [requested.hostname, counterpartHost]) {
      const candidate = new URL(requested);
      candidate.protocol = protocol;
      candidate.hostname = hostname;
      if ((protocol === "https:" && candidate.port === "80") || (protocol === "http:" && candidate.port === "443")) candidate.port = "";
      const normalized = candidate.toString();
      if (!candidates.includes(normalized)) candidates.push(normalized);
    }
  }
  return candidates;
}

export class LunaBrowserTools {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private readonly startedAt = Date.now();
  private readonly validPublicHosts = new Set<string>();
  private usage: AuditUsage = { ...EMPTY_USAGE };
  private readonly coverageState: CoverageState = {
    urlsDiscovered: new Set(), pagesOpened: new Set(), pagesVisuallyReviewed: new Set(),
    visualRegionsInspected: 0, imagesInspected: 0, categoriesInspected: new Set(),
    productsDiscovered: new Set(), productsVerified: 0, documentsInspected: new Set(),
    checkoutStatesInspected: new Set(), totalLunaToolCalls: 0,
  };

  constructor(
    readonly scanId: string,
    private readonly allowedHosts: Set<string>,
    readonly budget: AuditBudget,
  ) {
    for (const host of [...allowedHosts]) {
      this.allowedHosts.add(host.toLowerCase());
      this.allowedHosts.add(host.toLowerCase().startsWith("www.") ? host.toLowerCase().slice(4) : `www.${host.toLowerCase()}`);
    }
  }

  async start() {
    const env = getServerEnv();
    this.browser = await chromium.launch({
      headless: env.AI_SCANNER_BROWSER_HEADLESS,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: "en-US",
      acceptDownloads: false,
      serviceWorkers: "block",
    });
    await this.context.route("**/*", async (route) => {
      const request = route.request();
      if (!new Set(["GET", "HEAD"]).has(request.method())) return route.abort("blockedbyclient");
      const requestUrl = request.url();
      if (/^(data|blob|about):/.test(requestUrl)) return route.continue();
      try {
        const normalized = normalizePublicUrl(requestUrl);
        if (!this.validPublicHosts.has(normalized.hostname)) {
          await validatePublicUrl(normalized);
          this.validPublicHosts.add(normalized.hostname);
        }
        return route.continue();
      } catch {
        return route.abort("blockedbyclient");
      }
    });
    this.page = await this.context.newPage();
    this.page.setDefaultNavigationTimeout(30_000);
    this.page.setDefaultTimeout(15_000);
  }

  async close() {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
  }

  setUsage(usage: AuditUsage) { this.usage = { ...usage }; }

  coverage(): AuditCoverage {
    return {
      urlsDiscovered: [...this.coverageState.urlsDiscovered],
      pagesOpened: [...this.coverageState.pagesOpened],
      pagesVisuallyReviewed: [...this.coverageState.pagesVisuallyReviewed],
      visualRegionsInspected: this.coverageState.visualRegionsInspected,
      imagesInspected: this.coverageState.imagesInspected,
      categoriesInspected: [...this.coverageState.categoriesInspected],
      productsDiscovered: this.coverageState.productsDiscovered.size,
      productsVerified: this.coverageState.productsVerified,
      documentsInspected: [...this.coverageState.documentsInspected],
      checkoutStatesInspected: [...this.coverageState.checkoutStatesInspected],
      totalLunaToolCalls: this.coverageState.totalLunaToolCalls,
      auditRuntimeMs: Date.now() - this.startedAt,
      tokenUsage: { ...this.usage },
    };
  }

  budgetExceeded() {
    const coverage = this.coverage();
    return coverage.auditRuntimeMs >= this.budget.maximumRuntimeMs
      || coverage.totalLunaToolCalls >= this.budget.maximumToolCalls
      || this.usage.totalTokens >= this.budget.maximumTokens
      || this.usage.approximateCostUsd >= this.budget.maximumCostUsd;
  }

  async execute(callId: string, name: string, args: unknown): Promise<ToolExecutionResult> {
    const input = this.objectArgs(args);
    if (!aiScannerToolNames.has(name)) return { ok: false, evidenceIds: [], error: "Unknown AI Scanner tool" };
    if (this.budgetExceeded()) return { ok: false, evidenceIds: [], error: "Global AI Scanner budget exhausted" };
    const startedAt = Date.now();
    this.coverageState.totalLunaToolCalls++;
    await getDatabase().aiToolEvent.create({ data: { scanId: this.scanId, callId, name, input: json(this.safeInput(input)) } });
    logger.info({ scanId: this.scanId, toolName: name, toolCall: this.coverageState.totalLunaToolCalls }, "Luna tool requested");
    try {
      const result = await this.dispatch(name, input);
      const durationMs = Date.now() - startedAt;
      await getDatabase().aiToolEvent.update({
        where: { scanId_callId: { scanId: this.scanId, callId } },
        data: { status: "COMPLETED", completedAt: new Date(), durationMs, evidenceCount: result.evidenceIds.length, outputSummary: json({ ok: true, evidenceIds: result.evidenceIds, imageEvidenceIds: result.imageEvidenceIds ?? [] }) },
      });
      await this.persistLiveCoverage();
      logger.info({ scanId: this.scanId, toolName: name, durationMs, evidenceCount: result.evidenceIds.length, counters: this.coverage() }, "Luna tool completed");
      if (result.imageEvidenceIds?.length) logger.info({ scanId: this.scanId, toolName: name, imageEvidenceCount: result.imageEvidenceIds.length }, "Luna visual region inspected");
      if (name === "inspect_category") logger.info({ scanId: this.scanId, url: input.url }, "Luna category investigation");
      if (name === "inspect_product") logger.info({ scanId: this.scanId, url: input.url }, "Luna product investigation");
      if (new Set(["follow_internal_link", "scroll", "go_back"]).has(name)) logger.info({ scanId: this.scanId, toolName: name }, "Luna follow-up investigation");
      return result;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = sanitizeLogText(error instanceof Error ? error.message : "Tool failed");
      await getDatabase().aiToolEvent.update({
        where: { scanId_callId: { scanId: this.scanId, callId } },
        data: { status: "FAILED", completedAt: new Date(), durationMs, error: message },
      }).catch(() => undefined);
      await this.persistLiveCoverage().catch(() => undefined);
      logger.warn({ scanId: this.scanId, toolName: name, durationMs, error: serializeErrorForLog(error) }, "Luna tool failed; retaining completed audit work");
      return { ok: false, evidenceIds: [], error: message };
    }
  }

  async imageInputs(evidenceIds: string[]): Promise<ImageInput[]> {
    if (!evidenceIds.length) return [];
    const maximum = getServerEnv().AI_SCANNER_MAX_EVIDENCE_BYTES;
    const records = await getDatabase().aiEvidence.findMany({
      where: { scanId: this.scanId, id: { in: evidenceIds }, storageKey: { not: null }, mimeType: { startsWith: "image/" } },
      select: { id: true, storageKey: true, mimeType: true },
    });
    const images: ImageInput[] = [];
    for (const record of records) {
      if (!record.storageKey) continue;
      const bytes = await evidenceStorage().get(record.storageKey);
      if (!bytes?.length || bytes.byteLength > maximum) continue;
      const mimeType = record.mimeType ?? "image/jpeg";
      images.push({ evidenceId: record.id, mimeType, dataUrl: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}` });
    }
    return images;
  }

  private async dispatch(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    switch (name) {
      case "open_url": return this.openUrl(this.string(args.url));
      case "get_page_snapshot": return this.pageSnapshot(Boolean(args.includeScreenshot));
      case "get_visible_text": return this.visibleText(this.integer(args.maxChars, 20_000));
      case "get_dom": return this.dom(typeof args.selector === "string" ? args.selector : null, this.integer(args.maxChars, 20_000));
      case "get_links": return this.links(this.string(args.scope), this.integer(args.limit, 50));
      case "get_metadata": return this.metadata();
      case "get_structured_data": return this.structuredData();
      case "scroll": return this.scroll(this.integer(args.deltaY, 800));
      case "go_back": return this.goBack();
      case "follow_internal_link": return this.openUrl(this.string(args.url));
      case "inspect_navigation": return this.inspectRegion("nav, [role='navigation']", "VISUAL_REGION", "inspect_navigation");
      case "inspect_footer": return this.inspectRegion("footer, [role='contentinfo']", "VISUAL_REGION", "inspect_footer");
      case "inspect_category": return this.inspectCategory(this.string(args.url), typeof args.label === "string" ? args.label : null);
      case "enumerate_products": return this.enumerateProducts(this.integer(args.limit, 50));
      case "inspect_product": return this.inspectProduct(this.string(args.url));
      case "inspect_variants": return this.inspectVariants();
      case "capture_full_page": return this.capturePage(true, "capture_full_page");
      case "capture_viewport": return this.capturePage(false, "capture_viewport");
      case "capture_element": return this.inspectRegion(this.string(args.selector), "SCREENSHOT", "capture_element");
      case "inspect_visual_region": return this.inspectRegion(this.string(args.selector), "VISUAL_REGION", "inspect_visual_region");
      case "inspect_page_images": return this.inspectPageImages(this.integer(args.limit, 12));
      case "inspect_background_images": return this.inspectBackgroundImages(this.integer(args.limit, 12));
      case "inspect_carousel": return this.inspectCarousel(this.integer(args.limit, 8));
      case "inspect_pdf": return this.inspectPdf(this.string(args.url));
      case "inspect_public_api": return this.inspectPublicApi(this.string(args.url));
      case "inspect_checkout_read_only": return this.inspectCheckout(this.string(args.url));
      default: throw new Error("Unknown tool");
    }
  }

  private async openUrl(input: string) {
    const page = this.requirePage();
    const attempts: Array<{ url: string; error: string }> = [];
    let finalUrl: URL | undefined;
    let requestedUrl: URL | undefined;
    let httpStatus: number | undefined;
    for (const candidate of safeNavigationCandidates(input)) {
      const label = this.navigationLabel(candidate);
      try {
        requestedUrl = await this.firstPartyUrl(candidate);
        const response = await page.goto(requestedUrl.toString(), { waitUntil: "commit" });
        await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
        await page.waitForTimeout(500);
        finalUrl = await this.firstPartyUrl(page.url());
        httpStatus = response?.status();
        break;
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : "Navigation failed";
        const message = sanitizeLogText(rawMessage.replaceAll(candidate, label), 240);
        attempts.push({ url: label, error: message });
        logger.warn({ scanId: this.scanId, url: label, attempt: attempts.length, error: message }, "Luna browser navigation failed; trying a safe first-party equivalent");
      }
    }
    if (!finalUrl || !requestedUrl) {
      const detail = attempts.map((attempt) => `${attempt.url}: ${attempt.error}`).join("; ");
      throw new Error(`Merchant page could not be opened after ${attempts.length} safe first-party attempts${detail ? ` (${textLimit(detail, 900)})` : ""}`);
    }
    this.coverageState.pagesOpened.add(finalUrl.toString());
    this.coverageState.urlsDiscovered.add(finalUrl.toString());
    const snapshot = await this.pageSnapshot(true);
    return {
      ...snapshot,
      data: {
        ...(snapshot.data as object),
        requestedUrl: requestedUrl.toString(),
        navigationUrl: finalUrl.toString(),
        httpStatus,
        recoveredWithEquivalentUrl: requestedUrl.toString() !== safeNavigationCandidates(input)[0],
        failedNavigationAttempts: attempts,
      },
    };
  }

  private async pageSnapshot(includeScreenshot: boolean) {
    const page = this.requirePage();
    const url = page.url();
    const [title, visibleText, html, links] = await Promise.all([
      page.title().catch(() => ""),
      page.locator("body").innerText().catch(() => ""),
      page.locator("body").evaluate((node) => node.outerHTML).catch(() => ""),
      this.collectLinks(100).catch(() => []),
    ]);
    links.forEach((link) => this.coverageState.urlsDiscovered.add(link.href));
    const evidence = await this.retainEvidence({ toolName: "get_page_snapshot", kind: "PAGE_SNAPSHOT", sourceUrl: url, exactText: textLimit(visibleText), surroundingDom: { html: textLimit(html, 30_000), links }, metadata: { title, viewport: page.viewportSize() } });
    const evidenceIds = [evidence.id];
    const imageEvidenceIds: string[] = [];
    let screenshotWarning: string | null = null;
    if (includeScreenshot) {
      try {
        const screenshot = await this.capturePage(false, "get_page_snapshot");
        evidenceIds.push(...screenshot.evidenceIds);
        imageEvidenceIds.push(...(screenshot.imageEvidenceIds ?? []));
      } catch (error) {
        screenshotWarning = sanitizeLogText(error instanceof Error ? error.message : "Viewport capture failed", 240);
        logger.warn({ scanId: this.scanId, url: this.navigationLabel(url), error: screenshotWarning }, "Luna viewport capture failed; preserving completed page evidence");
      }
    }
    return { ok: true, evidenceIds, imageEvidenceIds, data: { url, title, visibleText: textLimit(visibleText, 20_000), links, viewport: page.viewportSize(), domExcerpt: textLimit(html, 12_000), screenshotCaptured: imageEvidenceIds.length > 0, screenshotWarning } };
  }

  private async visibleText(maxChars: number) {
    const page = this.requirePage();
    const exactText = textLimit(await page.locator("body").innerText(), maxChars);
    const evidence = await this.retainEvidence({ toolName: "get_visible_text", kind: "VISIBLE_TEXT", sourceUrl: page.url(), exactText });
    return { ok: true, evidenceIds: [evidence.id], data: { url: page.url(), exactText } };
  }

  private async dom(selector: string | null, maxChars: number) {
    const page = this.requirePage();
    const locator = selector ? page.locator(selector).first() : page.locator("body");
    const html = textLimit(await locator.evaluate((node) => node.outerHTML), maxChars);
    const evidence = await this.retainEvidence({ toolName: "get_dom", kind: "DOM", sourceUrl: page.url(), surroundingDom: { selector, html } });
    return { ok: true, evidenceIds: [evidence.id], data: { url: page.url(), selector, html } };
  }

  private async links(scope: string, maximum: number) {
    const page = this.requirePage();
    const current = new URL(page.url());
    const all = await this.collectLinks(maximum * 3);
    const selected = all.filter((link) => scope === "all" || (scope === "internal") === (new URL(link.href).hostname === current.hostname)).slice(0, maximum);
    selected.forEach((link) => this.coverageState.urlsDiscovered.add(link.href));
    const evidence = await this.retainEvidence({ toolName: "get_links", kind: "LINK", sourceUrl: page.url(), surroundingDom: { scope, links: selected } });
    return { ok: true, evidenceIds: [evidence.id], data: { url: page.url(), links: selected } };
  }

  private async metadata() {
    const page = this.requirePage();
    const metadata = await page.evaluate(() => ({
      title: document.title,
      lang: document.documentElement.lang || null,
      canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null,
      description: document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? null,
      robots: document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content ?? null,
      openGraph: [...document.querySelectorAll<HTMLMetaElement>('meta[property^="og:"]')].map((item) => ({ property: item.getAttribute("property"), content: item.content })),
    }));
    const evidence = await this.retainEvidence({ toolName: "get_metadata", kind: "METADATA", sourceUrl: page.url(), metadata });
    return { ok: true, evidenceIds: [evidence.id], data: metadata };
  }

  private async structuredData() {
    const page = this.requirePage();
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const parsed = blocks.map((block) => { try { return JSON.parse(block) as unknown; } catch { return { invalidJson: textLimit(block, 4_000) }; } });
    const evidence = await this.retainEvidence({ toolName: "get_structured_data", kind: "STRUCTURED_DATA", sourceUrl: page.url(), exactText: textLimit(blocks.join("\n")), metadata: { parsed } });
    return { ok: true, evidenceIds: [evidence.id], data: { url: page.url(), blocks: parsed } };
  }

  private async scroll(deltaY: number) {
    const page = this.requirePage();
    await page.evaluate((distance) => window.scrollBy({ top: distance, behavior: "instant" }), deltaY);
    await page.waitForTimeout(200);
    const capture = await this.capturePage(false, "scroll");
    return { ...capture, data: { url: page.url(), scrollY: await page.evaluate(() => window.scrollY), deltaY } };
  }

  private async goBack() {
    const page = this.requirePage();
    await page.goBack({ waitUntil: "domcontentloaded" });
    await this.firstPartyUrl(page.url());
    this.coverageState.pagesOpened.add(page.url());
    return this.pageSnapshot(true);
  }

  private async inspectCategory(url: string, label: string | null) {
    const result = await this.openUrl(url);
    this.coverageState.categoriesInspected.add(this.requirePage().url());
    const fact = await this.retainEvidence({ toolName: "inspect_category", kind: "CATEGORY_FACT", sourceUrl: this.requirePage().url(), exactText: label ?? undefined, metadata: { label } });
    return { ...result, evidenceIds: [...result.evidenceIds, fact.id], data: { ...(result.data as object), categoryLabel: label } };
  }

  private async enumerateProducts(maximum: number) {
    const page = this.requirePage();
    const candidates = await page.evaluate((limitValue) => {
      const jsonLd: unknown[] = [];
      for (const node of document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')) {
        try { jsonLd.push(JSON.parse(node.textContent || "null")); } catch { /* raw invalid data is retained by get_structured_data */ }
      }
      const anchors = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].slice(0, limitValue * 4).map((anchor) => {
        const container = anchor.closest("article, li, [class], section") ?? anchor.parentElement;
        return {
          href: anchor.href,
          anchorText: (anchor.innerText || anchor.getAttribute("aria-label") || "").trim().slice(0, 300),
          surroundingText: (container?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 800),
          imageCount: container?.querySelectorAll("img, picture, svg").length ?? 0,
        };
      });
      return { anchors, jsonLd };
    }, maximum);
    const unique = [...new Map(candidates.anchors.map((item) => [item.href, item])).values()].slice(0, maximum);
    unique.forEach((item) => this.coverageState.urlsDiscovered.add(item.href));
    this.findTypedObjects(candidates.jsonLd, "Product").forEach((item, index) => {
      const record = item as Record<string, unknown>;
      this.coverageState.productsDiscovered.add(this.nonEmpty(record.url) ?? `structured-product:${page.url()}:${index}`);
    });
    const evidence = await this.retainEvidence({ toolName: "enumerate_products", kind: "PRODUCT_FACT", sourceUrl: page.url(), surroundingDom: { candidates: unique }, metadata: { structuredData: candidates.jsonLd } });
    return { ok: true, evidenceIds: [evidence.id], data: { url: page.url(), candidates: unique, structuredData: candidates.jsonLd, note: "Candidates are raw navigation/structured-data observations, not tool-classified products." } };
  }

  private async inspectProduct(url: string) {
    const navigation = await this.openUrl(url);
    const page = this.requirePage();
    this.coverageState.productsDiscovered.add(page.url());
    const facts = await page.evaluate(() => {
      const parsed: unknown[] = [];
      for (const node of document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')) {
        try { parsed.push(JSON.parse(node.textContent || "null")); } catch { /* retained separately */ }
      }
      return {
        canonicalUrl: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? location.href,
        title: document.querySelector("h1")?.textContent?.trim() || document.title,
        itempropSku: document.querySelector<HTMLElement>('[itemprop="sku"]')?.getAttribute("content") || document.querySelector<HTMLElement>('[itemprop="sku"]')?.innerText || null,
        itempropPrice: document.querySelector<HTMLElement>('[itemprop="price"]')?.getAttribute("content") || document.querySelector<HTMLElement>('[itemprop="price"]')?.innerText || document.querySelector<HTMLMetaElement>('meta[property="product:price:amount"]')?.content || null,
        currency: document.querySelector<HTMLElement>('[itemprop="priceCurrency"]')?.getAttribute("content") || document.querySelector<HTMLMetaElement>('meta[property="product:price:currency"]')?.content || null,
        forms: [...document.forms].map((form) => ({ action: form.action, method: form.method, controls: [...form.elements].slice(0, 40).map((control) => ({ name: (control as HTMLInputElement).name || null, type: (control as HTMLInputElement).type || control.tagName })) })).slice(0, 20),
        buttons: [...document.querySelectorAll<HTMLElement>("button, [role='button'], input[type='submit']")].map((item) => (item.innerText || item.getAttribute("value") || item.getAttribute("aria-label") || "").trim()).filter(Boolean).slice(0, 40),
        structuredData: parsed,
      };
    });
    const productNodes = this.findTypedObjects(facts.structuredData, "Product");
    const product = productNodes[0] as Record<string, unknown> | undefined;
    const offers = product && typeof product.offers === "object" && product.offers !== null ? product.offers as Record<string, unknown> : undefined;
    const sku = this.nonEmpty(facts.itempropSku) ?? this.nonEmpty(product?.sku);
    const price = this.nonEmpty(facts.itempropPrice) ?? this.nonEmpty(offers?.price);
    const currency = this.nonEmpty(facts.currency) ?? this.nonEmpty(offers?.priceCurrency);
    const name = this.nonEmpty(product?.name) ?? facts.title;
    const canonicalFirstParty = (() => { try { return this.isFirstParty(normalizePublicUrl(facts.canonicalUrl)); } catch { return false; } })();
    const verified = canonicalFirstParty && (productNodes.length > 0 || Boolean(price && facts.forms.some((form) => form.controls.length > 0)));
    const evidence = await this.retainEvidence({ toolName: "inspect_product", kind: "PRODUCT_FACT", sourceUrl: page.url(), destinationUrl: facts.canonicalUrl, exactText: [name, sku, price, currency, ...facts.buttons].filter(Boolean).join("\n"), surroundingDom: { forms: facts.forms }, metadata: { ...facts, productNodes, verified } });
    if (verified) {
      await getDatabase().aiProduct.upsert({
        where: { scanId_canonicalUrl: { scanId: this.scanId, canonicalUrl: facts.canonicalUrl } },
        update: { name, sku, price, currency, objectiveSignals: json({ structuredProduct: productNodes.length > 0, priceObserved: Boolean(price), skuObserved: Boolean(sku), formCount: facts.forms.length, evidenceIds: [evidence.id] }), verified: true },
        create: { scanId: this.scanId, canonicalUrl: facts.canonicalUrl, name, sku, price, currency, objectiveSignals: json({ structuredProduct: productNodes.length > 0, priceObserved: Boolean(price), skuObserved: Boolean(sku), formCount: facts.forms.length, evidenceIds: [evidence.id] }), verified: true },
      });
      this.coverageState.productsVerified = await getDatabase().aiProduct.count({ where: { scanId: this.scanId, verified: true } });
    }
    return { ...navigation, evidenceIds: [...navigation.evidenceIds, evidence.id], data: { ...facts, structuredProductCount: productNodes.length, verified, sku: sku ?? "Not observed", price, currency, evidenceId: evidence.id } };
  }

  private async inspectVariants() {
    const page = this.requirePage();
    const variants = await page.evaluate(() => ({
      selects: [...document.querySelectorAll<HTMLSelectElement>("select")].map((select) => ({ name: select.name || select.id || null, options: [...select.options].map((option) => ({ label: option.text.trim(), value: option.value, disabled: option.disabled })) })),
      radios: [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((radio) => ({ name: radio.name, value: radio.value, checked: radio.checked, disabled: radio.disabled })),
    }));
    const evidence = await this.retainEvidence({ toolName: "inspect_variants", kind: "PRODUCT_FACT", sourceUrl: page.url(), surroundingDom: variants });
    return { ok: true, evidenceIds: [evidence.id], data: variants };
  }

  private async capturePage(fullPage: boolean, toolName: string) {
    const page = this.requirePage();
    const bytes = await page.screenshot({ type: "jpeg", quality: 85, fullPage, animations: "disabled", caret: "hide" });
    const metrics = await page.evaluate(() => ({ scrollX: window.scrollX, scrollY: window.scrollY, innerWidth: window.innerWidth, innerHeight: window.innerHeight, documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight }));
    const evidence = await this.retainEvidence({ toolName, kind: "SCREENSHOT", sourceUrl: page.url(), bytes, mimeType: "image/jpeg", metadata: { fullPage, metrics } });
    this.coverageState.pagesVisuallyReviewed.add(page.url());
    this.coverageState.visualRegionsInspected++;
    return { ok: true, evidenceIds: [evidence.id], imageEvidenceIds: [evidence.id], data: { url: page.url(), fullPage, metrics, evidenceId: evidence.id } };
  }

  private async inspectRegion(selector: string, kind: EvidenceKind, toolName: string) {
    const page = this.requirePage();
    const locator = page.locator(selector).first();
    await locator.scrollIntoViewIfNeeded();
    const context = await this.regionContext(locator);
    const bytes = await locator.screenshot({ type: "jpeg", quality: 90 });
    const evidence = await this.retainEvidence({ toolName, kind, sourceUrl: page.url(), destinationUrl: context.destinationUrl ?? undefined, exactText: context.visibleText, surroundingDom: { selector, html: context.html }, bytes, mimeType: "image/jpeg", metadata: context });
    this.coverageState.pagesVisuallyReviewed.add(page.url());
    this.coverageState.visualRegionsInspected++;
    return { ok: true, evidenceIds: [evidence.id], imageEvidenceIds: [evidence.id], data: { ...context, selector, evidenceId: evidence.id } };
  }

  private async inspectPageImages(maximum: number) {
    const page = this.requirePage();
    const locators = page.locator("img:visible, picture:visible");
    const count = Math.min(await locators.count(), maximum);
    const evidenceIds: string[] = [];
    const images: unknown[] = [];
    for (let index = 0; index < count; index++) {
      const locator = locators.nth(index);
      try {
        const context = await this.regionContext(locator);
        const source = await locator.evaluate((node) => node instanceof HTMLImageElement ? node.currentSrc || node.src : node.querySelector("img")?.currentSrc || null);
        const bytes = await locator.screenshot({ type: "jpeg", quality: 90 });
        const evidence = await this.retainEvidence({ toolName: "inspect_page_images", kind: "IMAGE", sourceUrl: page.url(), destinationUrl: context.destinationUrl ?? undefined, exactText: context.visibleText, surroundingDom: { html: context.html }, bytes, mimeType: "image/jpeg", metadata: { ...context, imageSource: source, index } });
        evidenceIds.push(evidence.id); images.push({ ...context, imageSource: source, evidenceId: evidence.id });
      } catch (error) {
        images.push({ index, error: error instanceof Error ? error.message : "Image capture failed" });
      }
    }
    this.coverageState.imagesInspected += evidenceIds.length;
    this.coverageState.pagesVisuallyReviewed.add(page.url());
    this.coverageState.visualRegionsInspected += evidenceIds.length;
    return { ok: true, evidenceIds, imageEvidenceIds: evidenceIds, data: { url: page.url(), images } };
  }

  private async inspectBackgroundImages(maximum: number) {
    const page = this.requirePage();
    const handles = await page.locator("body *").evaluateAll((nodes, limitValue) => nodes.map((node, index) => ({ index, backgroundImage: getComputedStyle(node).backgroundImage, rect: node.getBoundingClientRect().toJSON() })).filter((item) => item.backgroundImage && item.backgroundImage !== "none" && item.rect.width > 20 && item.rect.height > 20).slice(0, limitValue), maximum);
    const evidenceIds: string[] = [];
    const regions: unknown[] = [];
    for (const item of handles) {
      try {
        const locator = page.locator("body *").nth(item.index);
        const context = await this.regionContext(locator);
        const bytes = await locator.screenshot({ type: "jpeg", quality: 90 });
        const evidence = await this.retainEvidence({ toolName: "inspect_background_images", kind: "BACKGROUND_IMAGE", sourceUrl: page.url(), destinationUrl: context.destinationUrl ?? undefined, exactText: context.visibleText, surroundingDom: { html: context.html }, bytes, mimeType: "image/jpeg", metadata: { ...context, backgroundImage: item.backgroundImage } });
        evidenceIds.push(evidence.id); regions.push({ ...context, backgroundImage: item.backgroundImage, evidenceId: evidence.id });
      } catch (error) { regions.push({ backgroundImage: item.backgroundImage, error: error instanceof Error ? error.message : "Capture failed" }); }
    }
    this.coverageState.imagesInspected += evidenceIds.length;
    this.coverageState.visualRegionsInspected += evidenceIds.length;
    if (evidenceIds.length) this.coverageState.pagesVisuallyReviewed.add(page.url());
    return { ok: true, evidenceIds, imageEvidenceIds: evidenceIds, data: { url: page.url(), regions } };
  }

  private async inspectCarousel(maximum: number) {
    const page = this.requirePage();
    const indexes = await page.locator("body *").evaluateAll((nodes, limitValue) => nodes.map((node, index) => {
      const element = node as HTMLElement;
      const style = getComputedStyle(element);
      return { index, horizontalOverflow: element.scrollWidth > element.clientWidth * 1.15, childCount: element.children.length, ariaRoleDescription: element.getAttribute("aria-roledescription"), overflowX: style.overflowX };
    }).filter((item) => (item.ariaRoleDescription === "carousel" || (item.horizontalOverflow && item.childCount >= 2 && ["auto", "scroll", "hidden"].includes(item.overflowX)))).slice(0, limitValue), maximum);
    const evidenceIds: string[] = [];
    const regions: unknown[] = [];
    for (const item of indexes) {
      try {
        const locator = page.locator("body *").nth(item.index);
        const context = await this.regionContext(locator);
        const bytes = await locator.screenshot({ type: "jpeg", quality: 90 });
        const evidence = await this.retainEvidence({ toolName: "inspect_carousel", kind: "CAROUSEL", sourceUrl: page.url(), destinationUrl: context.destinationUrl ?? undefined, exactText: context.visibleText, surroundingDom: { html: context.html }, bytes, mimeType: "image/jpeg", metadata: { ...context, detection: item } });
        evidenceIds.push(evidence.id); regions.push({ ...context, detection: item, evidenceId: evidence.id });
      } catch (error) { regions.push({ detection: item, error: error instanceof Error ? error.message : "Capture failed" }); }
    }
    this.coverageState.visualRegionsInspected += evidenceIds.length;
    if (evidenceIds.length) this.coverageState.pagesVisuallyReviewed.add(page.url());
    return { ok: true, evidenceIds, imageEvidenceIds: evidenceIds, data: { url: page.url(), regions } };
  }

  private async inspectPdf(input: string) {
    const target = await this.firstPartyUrl(input);
    const response = await safeFetchBinary(target, { accept: "application/pdf,*/*;q=0.5", maxBytes: getServerEnv().AI_SCANNER_MAX_EVIDENCE_BYTES, timeoutMs: 30_000 });
    const isPdf = response.contentType.toLowerCase().includes("pdf") || target.pathname.toLowerCase().endsWith(".pdf");
    if (!isPdf) throw new Error("The selected resource was not observed as a PDF");
    let extractedText = "";
    let pageCount = 0;
    try {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const document = await pdfjs.getDocument({ data: response.bytes }).promise;
      pageCount = document.numPages;
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        extractedText += `\n[Page ${pageNumber}]\n${content.items.map((item) => "str" in item ? item.str : "").join(" ")}`;
        if (extractedText.length >= 50_000) break;
      }
    } catch (error) {
      extractedText = `PDF text extraction failed locally: ${error instanceof Error ? error.message : "unknown error"}`;
    }
    const evidence = await this.retainEvidence({ toolName: "inspect_pdf", kind: "PDF", sourceUrl: response.url.toString(), exactText: textLimit(extractedText), bytes: response.bytes, mimeType: response.contentType || "application/pdf", metadata: { pageCount, httpStatus: response.status } });
    const page = this.requirePage();
    const images: string[] = [];
    try {
      await page.goto(target.toString(), { waitUntil: "domcontentloaded" });
      const capture = await this.capturePage(false, "inspect_pdf");
      images.push(...(capture.imageEvidenceIds ?? []));
    } catch { /* text and original document remain valid retained evidence */ }
    this.coverageState.documentsInspected.add(response.url.toString());
    return { ok: true, evidenceIds: [evidence.id, ...images], imageEvidenceIds: images, data: { url: response.url.toString(), pageCount, extractedText: textLimit(extractedText, 30_000), documentEvidenceId: evidence.id } };
  }

  private async inspectPublicApi(input: string) {
    const target = await this.firstPartyUrl(input);
    const response = await safeFetchText(target, { accept: "application/json,text/plain,*/*;q=0.2", maxBytes: getServerEnv().AI_SCANNER_MAX_EVIDENCE_BYTES, timeoutMs: 30_000 });
    const raw = textLimit(response.text);
    let parsed: unknown = null;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    const evidence = await this.retainEvidence({ toolName: "inspect_public_api", kind: "PUBLIC_API", sourceUrl: response.url.toString(), exactText: raw, metadata: { status: response.status, contentType: response.contentType, parsed } });
    return { ok: true, evidenceIds: [evidence.id], data: { url: response.url.toString(), status: response.status, contentType: response.contentType, raw, parsed } };
  }

  private async inspectCheckout(input: string) {
    const result = await this.openUrl(input);
    const page = this.requirePage();
    this.coverageState.checkoutStatesInspected.add(page.url());
    const checkout = await page.evaluate(() => ({
      visibleText: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 30_000),
      forms: [...document.forms].map((form) => ({
        action: form.action,
        method: form.method,
        controls: [...form.elements].slice(0, 80).map((control) => {
          const element = control as HTMLInputElement;
          const explicitLabels = "labels" in element && element.labels
            ? [...element.labels].map((label) => (label.innerText || label.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean)
            : [];
          const nearbyText = (element.closest("label, fieldset, section, div")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 800);
          return {
            id: element.id || null,
            name: element.name || null,
            type: element.type || element.tagName.toLowerCase(),
            required: element.required || element.getAttribute("aria-required") === "true",
            checked: typeof element.checked === "boolean" ? element.checked : null,
            disabled: element.disabled,
            ariaLabel: element.getAttribute("aria-label"),
            labels: explicitLabels,
            nearbyText,
          };
        }),
      })).slice(0, 20),
    }));
    const evidence = await this.retainEvidence({
      toolName: "inspect_checkout_read_only",
      kind: "CHECKOUT_STATE",
      sourceUrl: page.url(),
      exactText: checkout.visibleText,
      surroundingDom: { forms: checkout.forms },
      metadata: { readOnly: true, noFormsSubmitted: true },
    });
    return { ...result, evidenceIds: [...result.evidenceIds, evidence.id], data: { ...(result.data as object), ...checkout, readOnly: true, noFormsSubmitted: true, checkoutEvidenceId: evidence.id } };
  }

  private async inspectRegionWithLocator(locator: Locator, kind: EvidenceKind, toolName: string) {
    const page = this.requirePage();
    const context = await this.regionContext(locator);
    const bytes = await locator.screenshot({ type: "jpeg", quality: 90 });
    const evidence = await this.retainEvidence({ toolName, kind, sourceUrl: page.url(), destinationUrl: context.destinationUrl ?? undefined, exactText: context.visibleText, surroundingDom: { html: context.html }, bytes, mimeType: "image/jpeg", metadata: context });
    return evidence.id;
  }

  private async regionContext(locator: Locator) {
    const page = this.requirePage();
    const box = await locator.boundingBox();
    const context = await locator.evaluate((node) => {
      const element = node as HTMLElement;
      const nearestLink = element.closest<HTMLAnchorElement>("a[href]") ?? element.querySelector<HTMLAnchorElement>("a[href]");
      const controls = [...element.querySelectorAll<HTMLElement>("a[href], button, [role='button']")].slice(0, 30).map((item) => ({ label: (item.innerText || item.getAttribute("aria-label") || "").trim().slice(0, 300), destination: item instanceof HTMLAnchorElement ? item.href : null, element: item.tagName.toLowerCase() }));
      return { visibleText: (element.innerText || "").trim().slice(0, 10_000), html: element.outerHTML.slice(0, 20_000), destinationUrl: nearestLink?.href ?? null, controls, childImageCount: element.querySelectorAll("img, picture, svg").length };
    });
    const viewport = page.viewportSize() ?? { width: 1, height: 1 };
    const position = box ? { x: box.x, y: box.y, width: box.width, height: box.height, viewportAreaRatio: Math.min(1, (box.width * box.height) / (viewport.width * viewport.height)), documentY: box.y + await page.evaluate(() => window.scrollY) } : null;
    return { ...context, pageUrl: page.url(), position };
  }

  private async collectLinks(maximum: number) {
    const page = this.requirePage();
    const raw = await page.locator("a[href]").evaluateAll((anchors, limitValue) => anchors.slice(0, limitValue).map((node) => {
      const anchor = node as HTMLAnchorElement;
      return { href: anchor.href, text: (anchor.innerText || anchor.getAttribute("aria-label") || "").trim().slice(0, 500), rel: anchor.rel || null };
    }), maximum);
    return raw.filter((item) => { try { return ["http:", "https:"].includes(new URL(item.href).protocol); } catch { return false; } });
  }

  private async retainEvidence(input: RetainEvidenceInput) {
    const source = normalizePublicUrl(input.sourceUrl);
    const firstParty = this.isFirstParty(source);
    if (!firstParty) throw new Error("Only first-party finding evidence can be retained by AI Scanner tools");
    const hash = createHash("sha256");
    hash.update(input.kind); hash.update("\0"); hash.update(source.toString()); hash.update("\0");
    if (input.exactText) hash.update(input.exactText);
    if (input.surroundingDom) hash.update(JSON.stringify(input.surroundingDom));
    if (input.bytes) hash.update(input.bytes);
    const sha256 = hash.digest("hex");
    let storageKey: string | undefined;
    if (input.bytes) {
      const extension = input.mimeType?.includes("pdf") ? "pdf" : input.mimeType?.includes("png") ? "png" : "jpg";
      storageKey = `ai-scanner/${this.scanId}/${sha256}.${extension}`;
      await evidenceStorage().put(storageKey, input.bytes);
    }
    return getDatabase().aiEvidence.upsert({
      where: { scanId_sha256: { scanId: this.scanId, sha256 } },
      update: { validated: true },
      create: {
        scanId: this.scanId,
        toolName: input.toolName,
        kind: input.kind,
        sourceUrl: source.toString(),
        destinationUrl: input.destinationUrl,
        firstParty,
        exactText: input.exactText,
        surroundingDom: input.surroundingDom === undefined ? undefined : json(input.surroundingDom),
        storageKey,
        mimeType: input.mimeType,
        sha256,
        metadata: json(input.metadata ?? {}),
        validated: true,
      },
      select: { id: true },
    });
  }

  private async persistLiveCoverage() {
    const coverage = this.coverage();
    await getDatabase().aiScan.update({ where: { id: this.scanId }, data: { toolCalls: coverage.totalLunaToolCalls, runtimeMs: coverage.auditRuntimeMs, coverage: json(coverage), usage: json(this.usage) } });
  }

  private async firstPartyUrl(input: string) {
    const url = await validatePublicUrl(input);
    if (!this.isFirstParty(url)) throw new Error(`Navigation outside registered merchant hosts is blocked: ${url.hostname}`);
    return url;
  }

  private isFirstParty(url: URL) { return this.allowedHosts.has(url.hostname.toLowerCase()); }
  private navigationLabel(input: string | URL) {
    try {
      const url = normalizePublicUrl(input.toString());
      return `${url.protocol}//${url.host}${url.pathname}`.slice(0, 300);
    } catch { return "invalid first-party URL"; }
  }
  private requirePage() { if (!this.page) throw new Error("Browser session has not started"); return this.page; }
  private objectArgs(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
  private string(value: unknown) { if (typeof value !== "string" || !value.trim()) throw new Error("A non-empty string argument is required"); return value; }
  private integer(value: unknown, fallback: number) { return typeof value === "number" && Number.isInteger(value) ? value : fallback; }
  private nonEmpty(value: unknown) { if (typeof value === "number") return String(value); return typeof value === "string" && value.trim() ? value.trim() : undefined; }
  private safeInput(value: Record<string, unknown>) { return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === "string" ? textLimit(item, 2_000) : item])); }

  private findTypedObjects(input: unknown, expectedType: string): unknown[] {
    const found: unknown[] = [];
    const visit = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
      if (types.includes(expectedType)) found.push(record);
      Object.values(record).forEach(visit);
    };
    visit(input);
    return found;
  }
}
