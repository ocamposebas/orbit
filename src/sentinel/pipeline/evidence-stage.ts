import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { getDatabase } from "@/sentinel/db";
import { getServerEnv } from "@/sentinel/config";
import { validatePublicUrl } from "@/sentinel/security/ssrf";
import { evidenceStorage } from "@/sentinel/storage";

export async function captureFindingEvidence(findingId: string) {
  const db = getDatabase();
  const finding = await db.finding.findUniqueOrThrow({ where: { id: findingId }, include: { evidence: { where: { kind: "TEXT" }, orderBy: { createdAt: "asc" } } } });
  const targets = [...new Map([{ pageUrl: finding.url, evidenceSnippet: finding.detectedText, role: "primary" }, ...finding.evidence.map((item) => ({ pageUrl: item.pageUrl, evidenceSnippet: item.evidenceSnippet, role: typeof item.metadata === "object" && item.metadata && !Array.isArray(item.metadata) && "role" in item.metadata ? String(item.metadata.role) : "supporting" }))].map((item) => [item.pageUrl, item])).values()].slice(0, 3);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1440, height: 1000 } });
    await context.route("**/*", async (route) => { try { const requestUrl = route.request().url(); if (/^(data|blob|about):/.test(requestUrl)) return route.continue(); await validatePublicUrl(requestUrl); await route.continue(); } catch { await route.abort("blockedbyclient"); } });
    const storageKeys: string[] = [];
    for (const target of targets) {
      const url = await validatePublicUrl(target.pageUrl);
      const page = await context.newPage();
      try {
        await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: getServerEnv().CRAWLER_NAVIGATION_TIMEOUT_MS });
        await page.waitForLoadState("networkidle", { timeout: 2_500 }).catch(() => undefined);
        const highlighted = target.evidenceSnippet ? await page.evaluate((snippet) => {
          const normalizedNeedle = snippet.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 180);
          const elements = [...document.querySelectorAll<HTMLElement>("main h1,main h2,main h3,main p,main li,article h1,article h2,article h3,article p,article li")];
          const match = elements.find((element) => (element.innerText || "").replace(/\s+/g, " ").toLowerCase().includes(normalizedNeedle));
          if (!match) return false;
          match.style.outline = "3px solid #818cf8"; match.style.outlineOffset = "4px"; match.scrollIntoView({ block: "center" }); return true;
        }, target.evidenceSnippet).catch(() => false) : false;
        const storageKey = `${finding.merchantId}/${finding.id}/${Date.now()}-${randomUUID()}.webp`;
        const screenshot = await page.screenshot({ type: "webp", fullPage: true });
        await evidenceStorage().put(storageKey, screenshot); storageKeys.push(storageKey);
        await db.findingEvidence.create({ data: { findingId, kind: "SCREENSHOT", pageUrl: url.toString(), pageHash: finding.fingerprint, storageKey, metadata: { capturedAt: new Date().toISOString(), viewport: "1440x1000", role: target.role, highlighted } } });
      } finally { await page.close(); }
    }
    await context.close();
    return storageKeys[0];
  } finally { await browser.close(); }
}
