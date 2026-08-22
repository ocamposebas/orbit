import type { Prisma } from "@/generated/prisma/client";
import { crawlSite, type CrawledPage } from "@/sentinel/crawler/crawl";
import { getDatabase } from "@/sentinel/db";
import { smartDiff } from "@/sentinel/analysis/diff";
import { updateProgress } from "@/sentinel/services/progress";

export async function runCrawlStage(scanId: string) {
  const db = getDatabase();
  const scan = await db.scan.findUniqueOrThrow({ where: { id: scanId }, include: { site: true } });
  await db.scan.update({ where: { id: scanId }, data: { status: "DISCOVERING", startedAt: scan.startedAt ?? new Date(), error: null } });
  await updateProgress(scanId, { stage: "discovering", message: "Reading site discovery signals" });
  const targeted = Array.isArray(scan.targetUrls) ? scan.targetUrls.filter((item): item is string => typeof item === "string") : [];
  const target = targeted[0] ?? scan.site.normalizedUrl;
  await db.scan.update({ where: { id: scanId }, data: { status: "CRAWLING" } });
  await updateProgress(scanId, { stage: "crawling", message: "Rendering public pages" });
  let pages: CrawledPage[];
  if (scan.mode === "TARGETED" && targeted.length) {
    pages = [];
    for (const targetedUrl of targeted) {
      const result = await crawlSite(targetedUrl, { maxPages: 1, maxDepth: 0, concurrency: 1 });
      pages.push(...result);
      await updateProgress(scanId, { stage: "crawling", message: "Rendering targeted pages", pagesProcessed: pages.length, pagesTotal: targeted.length, currentUrl: targetedUrl });
    }
  } else pages = await crawlSite(target, { maxPages: scan.mode === "QUICK" ? 25 : undefined, onProgress: async ({ processed, total, currentUrl }) => { await updateProgress(scanId, { stage: "crawling", message: "Rendering and normalizing pages", pagesProcessed: processed, pagesTotal: total, currentUrl }); } });
  await db.scan.update({ where: { id: scanId }, data: { pagesDiscovered: pages.length, pagesProcessed: pages.length } });
  await db.scan.update({ where: { id: scanId }, data: { status: "CLASSIFYING" } });
  await updateProgress(scanId, { stage: "classifying", message: "Persisting page classifications", pagesProcessed: pages.length, pagesTotal: pages.length });

  for (const page of pages) {
    const previous = page.hash ? await db.pageSnapshot.findFirst({ where: { scanPage: { siteId: scan.siteId, url: page.url } }, orderBy: { capturedAt: "desc" } }) : null;
    const scanPage = await db.scanPage.create({ data: { scanId, siteId: scan.siteId, url: page.url, canonicalUrl: page.canonicalUrl, httpStatus: page.status, contentType: page.contentType, title: page.title, metaDescription: page.description, robotsDirectives: page.robots, discoveredFrom: page.discoveredFrom, depth: page.depth, pageType: page.classification?.pageType ?? "OTHER", classificationConfidence: page.classification?.confidence ?? 0, classificationReasons: (page.classification?.reasons ?? []) as Prisma.InputJsonValue, normalizedContent: page.normalized as unknown as Prisma.InputJsonValue, contentHash: page.hash, inaccessibleReason: page.inaccessibleReason } });
    if (!page.normalized || !page.hash) continue;
    const snapshot = await db.pageSnapshot.create({ data: { scanPageId: scanPage.id, contentHash: page.hash, semanticHash: page.hash, normalizedContent: page.normalized as unknown as Prisma.InputJsonValue, visibleText: page.normalized.visibleText } });
    if (!previous) {
      await db.pageChange.create({ data: { scanId, scanPageId: scanPage.id, currentSnapshotId: snapshot.id, type: "NEW_PAGE", riskImpact: "NONE", diff: { additions: page.normalized.visibleText ? [page.normalized.visibleText.slice(0, 500)] : [], removals: [] }, summary: "Page first observed by ORBIT." } });
    } else if (previous.contentHash !== page.hash) {
      const diff = smartDiff(previous.visibleText, page.normalized.visibleText);
      await db.pageChange.create({ data: { scanId, scanPageId: scanPage.id, previousSnapshotId: previous.id, currentSnapshotId: snapshot.id, type: "CONTENT_CHANGE", riskImpact: diff.riskImpact, diff: diff as unknown as Prisma.InputJsonValue, summary: diff.summary } });
    }
  }
  await db.merchantSite.update({ where: { id: scan.siteId }, data: { lastScannedAt: new Date() } });
  return { pages: pages.length };
}
