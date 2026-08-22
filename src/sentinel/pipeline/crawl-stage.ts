import { Prisma } from "@/generated/prisma/client";
import { smartDiff } from "@/sentinel/analysis/diff";
import { crawlSite, type CrawledPage } from "@/sentinel/crawler/crawl";
import { getDatabase } from "@/sentinel/db";
import { advanceScanStatus, updateProgress } from "@/sentinel/services/progress";
import { normalizedContentSchema, type SentinelPageType } from "@/sentinel/types";

type StoredPage = {
  url: string;
  canonicalUrl: string | null;
  httpStatus: number | null;
  contentType: string | null;
  title: string | null;
  metaDescription: string | null;
  robotsDirectives: string | null;
  discoveredFrom: string | null;
  depth: number;
  pageType: string;
  classificationConfidence: number;
  classificationReasons: Prisma.JsonValue;
  normalizedContent: Prisma.JsonValue | null;
  contentHash: string | null;
  inaccessibleReason: string | null;
};

function resumeMap(rows: StoredPage[]) {
  const pages = new Map<string, CrawledPage>();
  for (const row of rows) {
    const normalized = normalizedContentSchema.safeParse(row.normalizedContent);
    const reasons = Array.isArray(row.classificationReasons) ? row.classificationReasons.filter((reason): reason is string => typeof reason === "string") : [];
    pages.set(row.url, {
      url: row.url,
      canonicalUrl: row.canonicalUrl ?? undefined,
      status: row.httpStatus ?? undefined,
      contentType: row.contentType ?? undefined,
      title: row.title ?? undefined,
      description: row.metaDescription ?? undefined,
      robots: row.robotsDirectives ?? undefined,
      discoveredFrom: row.discoveredFrom ?? undefined,
      depth: row.depth,
      normalized: normalized.success ? normalized.data : undefined,
      classification: { pageType: row.pageType as SentinelPageType, confidence: row.classificationConfidence, reasons },
      hash: row.contentHash ?? undefined,
      inaccessibleReason: row.inaccessibleReason ?? undefined,
    });
  }
  return pages;
}

async function persistCrawledPage(scanId: string, siteId: string, page: CrawledPage) {
  const db = getDatabase();
  const previous = page.hash ? await db.pageSnapshot.findFirst({ where: { scanPage: { siteId, url: page.url, scanId: { not: scanId } } }, orderBy: { capturedAt: "desc" } }) : null;
  const persistedPage = { canonicalUrl: page.canonicalUrl, httpStatus: page.status, contentType: page.contentType, title: page.title, metaDescription: page.description, robotsDirectives: page.robots, discoveredFrom: page.discoveredFrom, depth: page.depth, pageType: page.classification?.pageType ?? "OTHER", classificationConfidence: page.classification?.confidence ?? 0, classificationReasons: (page.classification?.reasons ?? []) as Prisma.InputJsonValue, normalizedContent: page.normalized as unknown as Prisma.InputJsonValue, contentHash: page.hash, inaccessibleReason: page.inaccessibleReason, lastSeenAt: new Date() };
  const scanPage = await db.scanPage.upsert({ where: { scanId_url: { scanId, url: page.url } }, update: persistedPage, create: { scanId, siteId, url: page.url, ...persistedPage } });
  if (!page.normalized || !page.hash) return scanPage;

  const existingSnapshot = await db.pageSnapshot.findFirst({ where: { scanPageId: scanPage.id, contentHash: page.hash }, orderBy: { capturedAt: "desc" } });
  const snapshot = existingSnapshot ?? await db.pageSnapshot.create({ data: { scanPageId: scanPage.id, contentHash: page.hash, semanticHash: page.hash, normalizedContent: page.normalized as unknown as Prisma.InputJsonValue, visibleText: page.normalized.visibleText } });
  const existingChange = await db.pageChange.findFirst({ where: { scanId, scanPageId: scanPage.id, currentSnapshotId: snapshot.id } });
  if (existingChange) return scanPage;
  if (!previous) {
    await db.pageChange.create({ data: { scanId, scanPageId: scanPage.id, currentSnapshotId: snapshot.id, type: "NEW_PAGE", riskImpact: "NONE", diff: { additions: page.normalized.visibleText ? [page.normalized.visibleText.slice(0, 500)] : [], removals: [] }, summary: "Page first observed by ORBIT." } });
  } else if (previous.contentHash !== page.hash) {
    const diff = smartDiff(previous.visibleText, page.normalized.visibleText);
    await db.pageChange.create({ data: { scanId, scanPageId: scanPage.id, previousSnapshotId: previous.id, currentSnapshotId: snapshot.id, type: "CONTENT_CHANGE", riskImpact: diff.riskImpact, diff: diff as unknown as Prisma.InputJsonValue, summary: diff.summary } });
  }
  return scanPage;
}

export async function runCrawlStage(scanId: string, options: { attempt?: number } = {}) {
  const db = getDatabase();
  const scan = await db.scan.findUniqueOrThrow({ where: { id: scanId }, include: { site: true } });
  const storedPages = await db.scanPage.findMany({ where: { scanId }, select: { url: true, canonicalUrl: true, httpStatus: true, contentType: true, title: true, metaDescription: true, robotsDirectives: true, discoveredFrom: true, depth: true, pageType: true, classificationConfidence: true, classificationReasons: true, normalizedContent: true, contentHash: true, inaccessibleReason: true } });
  if (scan.status === "CLASSIFYING" && scan.pagesProcessed > 0 && storedPages.length >= scan.pagesProcessed) {
    await updateProgress(scanId, { stage: "classifying", message: "Durable page set recovered; handing off to analysis", pagesProcessed: storedPages.length, pagesTotal: storedPages.length, recoveredPages: storedPages.length, attempt: options.attempt ?? 1, stageProcessed: storedPages.length, stageTotal: storedPages.length });
    return { pages: storedPages.length, recovered: storedPages.length };
  }

  const attempt = options.attempt ?? 1;
  const resumed = resumeMap(storedPages);
  const startedAt = scan.startedAt ?? new Date();
  if (!storedPages.length) {
    await advanceScanStatus(scanId, "DISCOVERING", { startedAt, error: null });
    await updateProgress(scanId, { stage: "discovering", message: "Reading site discovery signals", attempt, stageProcessed: 0, stageTotal: 1 });
  }
  await advanceScanStatus(scanId, "CRAWLING", { startedAt, error: null });
  await updateProgress(scanId, { stage: "crawling", message: storedPages.length ? `Recovering ${storedPages.length} durable pages before continuing` : "Rendering public pages", attempt, recoveredPages: storedPages.length, stageProcessed: storedPages.length, stageTotal: Math.max(storedPages.length, 1) });

  const targeted = Array.isArray(scan.targetUrls) ? scan.targetUrls.filter((item): item is string => typeof item === "string") : [];
  const target = targeted[0] ?? scan.site.normalizedUrl;
  const collected: CrawledPage[] = [];
  let recoveredPages = 0;
  let durablePages = Math.max(scan.pagesProcessed, storedPages.length);
  const onPage = async (page: CrawledPage, event: { processed: number; total: number; recovered: boolean }) => {
    await persistCrawledPage(scanId, scan.siteId, page);
    if (event.recovered) recoveredPages++;
    durablePages = Math.max(durablePages, event.processed, storedPages.length);
    const observedTotal = Math.max(durablePages, event.total);
    await db.scan.update({ where: { id: scanId }, data: { pagesProcessed: durablePages, pagesDiscovered: observedTotal } });
    await updateProgress(scanId, { stage: "crawling", message: event.recovered ? "Verified a previously persisted page" : "Rendered, normalized and persisted a public page", pagesProcessed: durablePages, pagesTotal: observedTotal, urlsFound: observedTotal, currentUrl: page.url, attempt, recoveredPages, stageProcessed: durablePages, stageTotal: observedTotal });
  };

  if (scan.mode === "TARGETED" && targeted.length) {
    for (const targetedUrl of targeted) {
      const result = await crawlSite(targetedUrl, { maxPages: 1, maxDepth: 0, concurrency: 1, resumePages: resumed, onPage });
      collected.push(...result);
    }
  } else {
    collected.push(...await crawlSite(target, { maxPages: scan.mode === "QUICK" ? 25 : undefined, resumePages: resumed, onPage }));
  }

  const persistedCount = await db.scanPage.count({ where: { scanId } });
  const analyzableCount = await db.scanPage.count({ where: { scanId, normalizedContent: { not: Prisma.JsonNull } } });
  if (!persistedCount || !collected.length) throw new Error("The crawler could not retrieve any public pages from this site.");
  if (!analyzableCount) throw new Error("Pages were reached, but none produced analyzable public content.");

  await advanceScanStatus(scanId, "CLASSIFYING", { pagesDiscovered: persistedCount, pagesProcessed: persistedCount });
  await updateProgress(scanId, { stage: "classifying", message: "Durable page set verified; handing off to analysis", pagesProcessed: persistedCount, pagesTotal: persistedCount, urlsFound: persistedCount, attempt, recoveredPages, stageProcessed: persistedCount, stageTotal: persistedCount });
  await db.merchantSite.update({ where: { id: scan.siteId }, data: { lastScannedAt: new Date() } });
  return { pages: persistedCount, recovered: recoveredPages };
}
