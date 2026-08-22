import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { getDatabase } from "@/sentinel/db";
import { getServerEnv } from "@/sentinel/config";
import { validatePublicUrl } from "@/sentinel/security/ssrf";
import { evidenceStorage } from "@/sentinel/storage";

export async function captureFindingEvidence(findingId: string) {
  const db = getDatabase();
  const finding = await db.finding.findUniqueOrThrow({ where: { id: findingId } });
  const url = await validatePublicUrl(finding.url);
  const storageKey = `${finding.merchantId}/${finding.id}/${Date.now()}-${randomUUID()}.webp`;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1440, height: 1000 } });
    await context.route("**/*", async (route) => { try { const requestUrl = route.request().url(); if (/^(data|blob|about):/.test(requestUrl)) return route.continue(); await validatePublicUrl(requestUrl); await route.continue(); } catch { await route.abort("blockedbyclient"); } });
    const page = await context.newPage();
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: getServerEnv().CRAWLER_NAVIGATION_TIMEOUT_MS });
    const screenshot = await page.screenshot({ type: "webp", fullPage: true });
    await evidenceStorage().put(storageKey, screenshot);
    await db.findingEvidence.create({ data: { findingId, kind: "SCREENSHOT", pageUrl: url.toString(), pageHash: finding.fingerprint, storageKey, metadata: { capturedAt: new Date().toISOString(), viewport: "1440x1000" } } });
    await context.close();
    return storageKey;
  } finally { await browser.close(); }
}
