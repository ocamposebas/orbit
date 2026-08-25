import { createHash } from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getServerEnv } from "@/sentinel/config";
import { getDatabase } from "@/sentinel/db";
import { contentHash } from "@/sentinel/extraction/normalize";
import { logger } from "@/sentinel/logger";
import { validatePublicUrl } from "@/sentinel/security/ssrf";
import { evidenceStorage } from "@/sentinel/storage";
import type { CandidateFinding, SentinelPageType } from "@/sentinel/types";
import type { SemanticPageInput } from "./hybrid-semantic";

export const VISUAL_PROMPT_VERSION = "sentinel-visual-v1";

const visualObservationSchema = z.object({
  assetIndex: z.number().int().min(0).max(20),
  category: z.enum(["HUMAN_BODY", "BEFORE_AFTER", "WEIGHT_MANAGEMENT", "MUSCLE_PERFORMANCE", "DOSING_ADMINISTRATION", "MEDICAL_CLINICAL", "THERAPEUTIC_OUTCOME", "COGNITIVE_PERFORMANCE", "REPRODUCTIVE_SEXUAL", "RESEARCH_LABORATORY", "IMAGE_DISCLAIMER", "OTHER"]),
  classification: z.enum(["ADVERSE", "MITIGATING", "NEUTRAL", "INFORMATIONAL", "CONTRADICTORY"]),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]),
  confidence: z.number().min(0).max(1),
  visibleText: z.string().max(2_000),
  visualDescription: z.string().min(1).max(2_000),
  contextualExplanation: z.string().min(1).max(2_000),
  materialContext: z.boolean(),
  humanReviewRequired: z.boolean(),
}).strict();

export const visualAnalysisSchema = z.object({ observations: z.array(visualObservationSchema).max(30) }).strict();
export type VisualAnalysis = z.infer<typeof visualAnalysisSchema>;

export interface VisualAsset {
  pageUrl: string;
  pageType: SentinelPageType;
  kind: "FULL_PAGE" | "VIEWPORT" | "HERO_BANNER" | "CATEGORY_BANNER" | "PRODUCT_IMAGE" | "PROMOTIONAL_GRAPHIC" | "BLOG_GRAPHIC" | "CHECKOUT";
  selector: string;
  hash: string;
  storageKey: string;
  mimeType: "image/jpeg";
  bytes: Uint8Array;
}

export interface VisualIntelligenceStats {
  pagesSelected: number;
  pagesAnalyzed: number;
  assetsDiscovered: number;
  assetsAnalyzed: number;
  cacheHits: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

const visualSystemPrompt = `You are ORBIT Sentinel's visual merchant-intelligence observation engine.
Analyze the supplied rendered website images together with their page context. Return only the strict JSON schema.
Identify human-body, before/after, transformation, weight-management, bodybuilding or muscle, administration or injection, medical/clinical, therapeutic, cognitive/performance, reproductive/sexual, laboratory/research, and image-disclaimer context.
A vial, pill, needle, syringe, laboratory coat, or human body is not adverse by itself. Judge the complete commercial and textual context.
Text visible inside an image may support an observation, but OCR-like text alone must never become an adverse finding without material promotional or contradictory context.
Warnings, restrictions, technical laboratory displays, and disclaimers are mitigating, neutral, or informational unless genuinely contradicted by another element in the same asset.
Never decide merchant approval, compliance, legality, certification, processor eligibility, or final score. Produce observations only.`;

function digest(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }

function visualPagePriority(page: SemanticPageInput) {
  const weights: Partial<Record<SentinelPageType, number>> = { PRODUCT: 100, COLLECTION: 92, CATEGORY: 92, CHECKOUT: 90, CART: 86, HOME: 84, LANDING: 80, ARTICLE: 60, BLOG: 55 };
  const commercial = page.content.claims.length * 4 + page.content.images.length * 2 + page.content.prices.length * 3;
  return (weights[page.pageType] ?? 20) + Math.min(commercial, 30);
}

async function secureVisualContext(): Promise<{ context: BrowserContext; close: () => Promise<void> }> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1440, height: 1000 }, acceptDownloads: false });
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (!["GET", "HEAD"].includes(request.method()) || ["websocket", "eventsource"].includes(request.resourceType())) return route.abort("blockedbyclient");
    const url = request.url();
    if (/^(?:data|blob|about):/.test(url)) return route.continue();
    try { await validatePublicUrl(url); await route.continue(); } catch { await route.abort("blockedbyclient"); }
  });
  return { context, close: async () => { await context.close(); await browser.close(); } };
}

async function jpegScreenshot(page: Page, fullPage: boolean) {
  return new Uint8Array(await page.screenshot({ type: "jpeg", quality: 65, fullPage, animations: "disabled", caret: "hide" }));
}

async function capturePageAssets(scanId: string, input: SemanticPageInput, maximum: number, context: BrowserContext): Promise<VisualAsset[]> {
  const page = await context.newPage();
  const assets: VisualAsset[] = [];
  const retain = async (kind: VisualAsset["kind"], selector: string, bytes: Uint8Array) => {
    if (bytes.byteLength > getServerEnv().AI_VISUAL_MAX_IMAGE_BYTES) return;
    const hash = digest(bytes);
    const storageKey = `${scanId}/visual/${hash}.jpg`;
    await evidenceStorage().put(storageKey, bytes);
    assets.push({ pageUrl: input.url, pageType: input.pageType, kind, selector, hash, storageKey, mimeType: "image/jpeg", bytes });
  };
  try {
    await page.goto((await validatePublicUrl(input.url)).toString(), { waitUntil: "domcontentloaded", timeout: getServerEnv().CRAWLER_NAVIGATION_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 2_500 }).catch(() => undefined);
    await retain(input.pageType === "CHECKOUT" || input.pageType === "CART" ? "CHECKOUT" : "VIEWPORT", "viewport", await jpegScreenshot(page, false));
    if (assets.length < maximum) await retain("FULL_PAGE", "html", await jpegScreenshot(page, true)).catch(() => undefined);
    const selectorGroups: Array<[string, VisualAsset["kind"]]> = [
      ["main [class*='hero' i],main [class*='banner' i],header [class*='hero' i]", input.pageType === "CATEGORY" || input.pageType === "COLLECTION" ? "CATEGORY_BANNER" : "HERO_BANNER"],
      ["main img,article img", input.pageType === "PRODUCT" ? "PRODUCT_IMAGE" : input.pageType === "ARTICLE" || input.pageType === "BLOG" ? "BLOG_GRAPHIC" : "PROMOTIONAL_GRAPHIC"],
    ];
    for (const [selector, kind] of selectorGroups) {
      const locators = page.locator(selector);
      for (let index = 0; index < Math.min(await locators.count().catch(() => 0), maximum - assets.length); index++) {
        const locator = locators.nth(index);
        const box = await locator.boundingBox().catch(() => null);
        if (!box || box.width < 180 || box.height < 100) continue;
        const bytes = await locator.screenshot({ type: "jpeg", quality: 72, animations: "disabled", caret: "hide" }).catch(() => null);
        if (bytes) await retain(kind, `${selector}:nth-match(${index + 1})`, new Uint8Array(bytes));
      }
      if (assets.length >= maximum) break;
    }
    return [...new Map(assets.map((asset) => [asset.hash, asset])).values()];
  } finally { await page.close(); }
}

type ProviderResponse = { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };

function responseText(response: ProviderResponse) {
  const content = response.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : Array.isArray(content) ? content.map((item) => item.text ?? "").join("") : "";
}

async function callVisionModel(assets: VisualAsset[], page: SemanticPageInput) {
  const env = getServerEnv();
  if (env.AI_PROVIDER !== "openai-compatible" || !env.AI_API_KEY) throw new Error("Vision model is not configured");
  const payload = { pageUrl: page.url, pageType: page.pageType, title: page.content.title, headings: page.content.headings, productName: page.content.productName, disclaimers: page.content.disclaimers, assets: assets.map((asset, assetIndex) => ({ assetIndex, kind: asset.kind, selector: asset.selector, hash: asset.hash })) };
  const cacheHash = contentHash({ prompt: VISUAL_PROMPT_VERSION, payload });
  const db = getDatabase();
  const existing = await db.semanticAnalysis.findUnique({ where: { contentHash_promptVersion_provider_model: { contentHash: cacheHash, promptVersion: VISUAL_PROMPT_VERSION, provider: "openai-compatible-vision", model: env.AI_VISION_MODEL } } });
  if (existing) return { result: visualAnalysisSchema.parse(existing.result), usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, cached: true } };
  const schema = z.toJSONSchema(visualAnalysisSchema) as Record<string, unknown>; delete schema.$schema;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);
  try {
    const response = await fetch(`${env.AI_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST", signal: controller.signal,
      headers: { authorization: `Bearer ${env.AI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: env.AI_VISION_MODEL, temperature: 0, max_tokens: env.AI_MAX_OUTPUT_TOKENS, response_format: { type: "json_schema", json_schema: { name: "orbit_visual_analysis", strict: true, schema } }, messages: [{ role: "system", content: visualSystemPrompt }, { role: "user", content: [{ type: "text", text: JSON.stringify(payload) }, ...assets.map((asset) => ({ type: "image_url", image_url: { url: `data:${asset.mimeType};base64,${Buffer.from(asset.bytes).toString("base64")}`, detail: "high" } }))] }] }),
    });
    if (!response.ok) throw new Error(`Vision provider returned HTTP ${response.status}`);
    const raw = await response.json() as ProviderResponse;
    const text = responseText(raw);
    const result = visualAnalysisSchema.parse(JSON.parse(text));
    const inputTokens = raw.usage?.prompt_tokens ?? Math.ceil(JSON.stringify(payload).length / 4);
    const outputTokens = raw.usage?.completion_tokens ?? Math.ceil(text.length / 4);
    const estimatedCostUsd = inputTokens * (env.AI_VISION_INPUT_COST_PER_MILLION ?? env.AI_INPUT_COST_PER_MILLION) / 1_000_000 + outputTokens * (env.AI_VISION_OUTPUT_COST_PER_MILLION ?? env.AI_OUTPUT_COST_PER_MILLION) / 1_000_000;
    const configuration = { temperature: 0, structuredOutput: true, usage: { inputTokens, outputTokens, estimatedCostUsd } } as unknown as Prisma.InputJsonValue;
    await db.semanticAnalysis.create({ data: { contentHash: cacheHash, promptVersion: VISUAL_PROMPT_VERSION, provider: "openai-compatible-vision", model: env.AI_VISION_MODEL, configuration, result: result as unknown as Prisma.InputJsonValue } });
    return { result, usage: { inputTokens, outputTokens, estimatedCostUsd, cached: false } };
  } finally { clearTimeout(timeout); }
}

const titleByVisualCategory: Record<VisualAnalysis["observations"][number]["category"], string> = {
  HUMAN_BODY: "Consumer-oriented human imagery requires review", BEFORE_AFTER: "Before-and-after visual positioning requires review", WEIGHT_MANAGEMENT: "Weight-management visual positioning requires review", MUSCLE_PERFORMANCE: "Muscle or performance visual positioning requires review", DOSING_ADMINISTRATION: "Administration imagery requires review", MEDICAL_CLINICAL: "Medical or clinical visual positioning requires review", THERAPEUTIC_OUTCOME: "Therapeutic outcome imagery requires review", COGNITIVE_PERFORMANCE: "Cognitive or performance imagery requires review", REPRODUCTIVE_SEXUAL: "Reproductive or sexual-health imagery requires review", RESEARCH_LABORATORY: "Research or laboratory visual context", IMAGE_DISCLAIMER: "Disclaimer observed inside visual evidence", OTHER: "Visual positioning requires review",
};

export function visualCandidates(page: SemanticPageInput, assets: VisualAsset[], analysis: VisualAnalysis, model: string): CandidateFinding[] {
  return analysis.observations.flatMap((observation) => {
    const asset = assets[observation.assetIndex];
    if (!asset || !observation.humanReviewRequired || !observation.materialContext || observation.confidence < 0.7 || !["ADVERSE", "CONTRADICTORY"].includes(observation.classification)) return [];
    const severity = observation.severity === "CRITICAL" && !(observation.category === "DOSING_ADMINISTRATION" && observation.confidence >= 0.9) ? "HIGH" : observation.severity;
    return [{ ruleKey: `VISUAL-${observation.category}`, severity, confidence: observation.confidence, status: "NEEDS_REVIEW", category: "Visual positioning", title: titleByVisualCategory[observation.category], description: "A multimodal review identified material visual context requiring human review.", url: page.url, pageType: page.pageType, detectedText: observation.visibleText || observation.visualDescription, reason: observation.contextualExplanation, recommendedAction: "Review the cited visual in its complete page and commercial context.", scoreComponent: observation.category === "DOSING_ADMINISTRATION" ? "RESEARCH_CONTROLS" : "MARKETING_RISK", analysisSource: "SEMANTIC_PAGE", evidenceType: asset.kind, humanReviewRequired: true, modelVersion: model, provider: "openai-compatible-vision", semanticCategory: observation.category, semanticClassification: observation.classification, promptVersion: VISUAL_PROMPT_VERSION, evidenceClassification: observation.classification, prominence: ["PRODUCT_IMAGE", "HERO_BANNER", "CATEGORY_BANNER", "CHECKOUT"].includes(asset.kind) ? "PRIMARY_COMMERCIAL" : page.pageType === "ARTICLE" ? "EDITORIAL" : "SITEWIDE", domSelector: asset.selector, sourceKind: "VISUAL", assetStorageKey: asset.storageKey, assetHash: asset.hash } satisfies CandidateFinding];
  });
}

export async function runVisualIntelligence(scanId: string, pages: SemanticPageInput[]) {
  const env = getServerEnv();
  const selected = [...pages].filter((page) => page.httpStatus === undefined || page.httpStatus < 400).sort((left, right) => visualPagePriority(right) - visualPagePriority(left)).slice(0, env.AI_VISUAL_MAX_PAGES);
  const stats: VisualIntelligenceStats = { pagesSelected: selected.length, pagesAnalyzed: 0, assetsDiscovered: pages.reduce((sum, page) => sum + page.content.images.length, 0), assetsAnalyzed: 0, cacheHits: 0, failures: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
  if (env.AI_PROVIDER !== "openai-compatible" || !env.AI_API_KEY || !selected.length) return { candidates: [] as CandidateFinding[], stats };
  const browser = await secureVisualContext();
  const candidates: CandidateFinding[] = [];
  const seenHashes = new Set<string>();
  try {
    for (const page of selected) {
      try {
        const captured = await capturePageAssets(scanId, page, env.AI_VISUAL_MAX_ASSETS_PER_PAGE, browser.context);
        const assets = captured.filter((asset) => !seenHashes.has(asset.hash));
        for (const asset of assets) seenHashes.add(asset.hash);
        if (!assets.length) continue;
        const run = await callVisionModel(assets, page);
        stats.pagesAnalyzed++;
        stats.assetsAnalyzed += assets.length;
        stats.cacheHits += Number(run.usage.cached);
        stats.inputTokens += run.usage.inputTokens;
        stats.outputTokens += run.usage.outputTokens;
        stats.estimatedCostUsd += run.usage.estimatedCostUsd;
        candidates.push(...visualCandidates(page, assets, run.result, env.AI_VISION_MODEL));
      } catch (error) {
        stats.failures++;
        logger.warn({ error, pageUrl: page.url }, "Visual analysis failed; deterministic and text analysis remain available");
      }
    }
  } finally { await browser.close(); }
  stats.estimatedCostUsd = Number(stats.estimatedCostUsd.toFixed(6));
  return { candidates, stats };
}
