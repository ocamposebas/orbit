import type { Prisma } from "@/generated/prisma/client";
import { crawlSite, type CrawledPage } from "@/sentinel/crawler/crawl";
import { getDatabase } from "@/sentinel/db";
import { smartDiff } from "@/sentinel/analysis/diff";
import { updateProgress } from "@/sentinel/services/progress";

export async function runCrawlStage(scanId: string) {
  const db = getDatabase();
  const scan = await db.scan.findUniqueOrThrow({ where: { id: scanId }, include: { site: true } });
  const persistedPageCount = await db.scanPage.count({ where: { scanId } });
  if (scan.status === "CLASSIFYING" && scan.pagesProcessed > 0 && persistedPageCount >= scan.pagesProcessed) {
    await updateProgress(scanId, { stage: "classifying", message: "Page classifications persisted; handing off to analysis", pagesProcessed: persistedPageCount, pagesTotal: persistedPageCount });
    return { pages: persistedPageCount, resumed: true };
  }
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
  if (!pages.length) throw new Error("The crawler could not retrieve any public pages from this site.");
  await db.scan.update({ where: { id: scanId }, data: { pagesDiscovered: pages.length, pagesProcessed: pages.length } });
  await db.scan.update({ where: { id: scanId }, data: { status: "CLASSIFYING" } });
  await updateProgress(scanId, { stage: "classifying", message: "Persisting page classifications", pagesProcessed: pages.length, pagesTotal: pages.length });

  for (const [index, page] of pages.entries()) {
    const previous = page.hash ? await db.pageSnapshot.findFirst({ where: { scanPage: { siteId: scan.siteId, url: page.url, scanId: { not: scanId } } }, orderBy: { capturedAt: "desc" } }) : null;
    const persistedPage = { canonicalUrl: page.canonicalUrl, httpStatus: page.status, contentType: page.contentType, title: page.title, metaDescription: page.description, robotsDirectives: page.robots, discoveredFrom: page.discoveredFrom, depth: page.depth, pageType: page.classification?.pageType ?? "OTHER", classificationConfidence: page.classification?.confidence ?? 0, classificationReasons: (page.classification?.reasons ?? []) as Prisma.InputJsonValue, normalizedContent: page.normalized as unknown as Prisma.InputJsonValue, contentHash: page.hash, inaccessibleReason: page.inaccessibleReason, lastSeenAt: new Date() };
    const scanPage = await db.scanPage.upsert({ where: { scanId_url: { scanId, url: page.url } }, update: persistedPage, create: { scanId, siteId: scan.siteId, url: page.url, ...persistedPage } });
    if (!page.normalized || !page.hash) continue;
    const existingSnapshot = await db.pageSnapshot.findFirst({ where: { scanPageId: scanPage.id, contentHash: page.hash }, orderBy: { capturedAt: "desc" } });
    const snapshot = existingSnapshot ?? await db.pageSnapshot.create({ data: { scanPageId: scanPage.id, contentHash: page.hash, semanticHash: page.hash, normalizedContent: page.normalized as unknown as Prisma.InputJsonValue, visibleText: page.normalized.visibleText } });
    const existingChange = await db.pageChange.findFirst({ where: { scanId, scanPageId: scanPage.id, currentSnapshotId: snapshot.id } });
    if (existingChange) continue;
    if (!previous) {
      await db.pageChange.create({ data: { scanId, scanPageId: scanPage.id, currentSnapshotId: snapshot.id, type: "NEW_PAGE", riskImpact: "NONE", diff: { additions: page.normalized.visibleText ? [page.normalized.visibleText.slice(0, 500)] : [], removals: [] }, summary: "Page first observed by ORBIT." } });
    } else if (previous.contentHash !== page.hash) {
      const diff = smartDiff(previous.visibleText, page.normalized.visibleText);
      await db.pageChange.create({ data: { scanId, scanPageId: scanPage.id, previousSnapshotId: previous.id, currentSnapshotId: snapshot.id, type: "CONTENT_CHANGE", riskImpact: diff.riskImpact, diff: diff as unknown as Prisma.InputJsonValue, summary: diff.summary } });
    }
    if ((index + 1) % 10 === 0 || index === pages.length - 1) await updateProgress(scanId, { stage: "classifying", message: `Persisting page classifications (${index + 1}/${pages.length})`, pagesProcessed: pages.length, pagesTotal: pages.length });
  }
  await db.merchantSite.update({ where: { id: scan.siteId }, data: { lastScannedAt: new Date() } });
  await updateProgress(scanId, { stage: "classifying", message: "Page classifications persisted; handing off to analysis", pagesProcessed: pages.length, pagesTotal: pages.length });
  return { pages: pages.length };
}
