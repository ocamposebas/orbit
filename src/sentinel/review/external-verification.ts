import * as cheerio from "cheerio";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getServerEnv } from "@/sentinel/config";
import { getDatabase } from "@/sentinel/db";
import { persistArtifactEvidence } from "@/sentinel/evidence/ledger";
import { contentHash, normalizeText } from "@/sentinel/extraction/normalize";
import { safeFetchText } from "@/sentinel/security/ssrf";
import type { LunaMerchantReview } from "./schema";

export const EXTERNAL_VERIFICATION_PROMPT_VERSION = "orbit-external-public-web-v1";

const externalResultSchema = z.object({
  version: z.literal("orbit-external-public-web-v1"),
  results: z.array(z.object({
    issueKey: z.string().min(1),
    merchantClaimEvidenceId: z.string().min(1),
    state: z.enum(["SUPPORTED", "REFUTED", "INCONCLUSIVE"]),
    summary: z.string().min(1).max(2_000),
    sources: z.array(z.object({ url: z.string().url(), title: z.string().max(500) }).strict()).max(8),
  }).strict()).max(20),
}).strict();

type ExternalResult = z.infer<typeof externalResultSchema>;
type ApiResponse = { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string; annotations?: Array<{ type?: string; url?: string; title?: string }> }> }>; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } };

function responseText(response: ApiResponse) {
  return response.output_text || response.output?.flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("") || "";
}

function citedUrls(response: ApiResponse) {
  return new Set(response.output?.flatMap((item) => item.content ?? []).flatMap((content) => content.annotations ?? []).filter((annotation) => annotation.type === "url_citation" && annotation.url).map((annotation) => annotation.url!) ?? []);
}

function readablePage(html: string) {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg").remove();
  return { title: normalizeText($("title").text()), text: normalizeText($("body").text()).slice(0, 100_000) };
}

export async function runExternalPublicWebVerification(input: { scanId: string; merchantId: string; merchantUrl: string; review: LunaMerchantReview }) {
  const env = getServerEnv();
  const requests = input.review.observations.flatMap((observation) => observation.externalVerificationRequest ? [{ issueKey: observation.issueKey, ...observation.externalVerificationRequest }] : []).filter((request) => input.review.observations.find((observation) => observation.issueKey === request.issueKey)?.materiality === "MATERIAL").slice(0, env.EXTERNAL_VERIFICATION_MAX_CLAIMS);
  if (!env.EXTERNAL_VERIFICATION_ENABLED || !requests.length || env.AI_PROVIDER !== "openai-compatible" || !env.AI_API_KEY) return undefined;
  const schema = z.toJSONSchema(externalResultSchema) as Record<string, unknown>; delete schema.$schema;
  const payload = { merchantOrigin: new URL(input.merchantUrl).origin, claims: requests };
  const inputManifestHash = contentHash({ promptVersion: EXTERNAL_VERIFICATION_PROMPT_VERSION, payload });
  const db = getDatabase();
  const cached = await db.reviewRun.findFirst({ where: { inputManifestHash, promptVersion: EXTERNAL_VERIFICATION_PROMPT_VERSION, provider: "openai-responses-web-search", model: env.AI_REVIEW_MODEL, role: "EXTERNAL", status: "COMPLETED" }, orderBy: { completedAt: "desc" } });
  if (cached) return { result: externalResultSchema.parse(cached.output), runId: cached.id, cached: true };
  const run = await db.reviewRun.create({ data: { scanId: input.scanId, role: "EXTERNAL", provider: "openai-responses-web-search", model: env.AI_REVIEW_MODEL, promptVersion: EXTERNAL_VERIFICATION_PROMPT_VERSION, inputManifestHash, configuration: { store: false, evidenceScope: "EXTERNAL_PUBLIC_WEB" } } });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);
  try {
    const response = await fetch(`${env.AI_BASE_URL.replace(/\/$/, "")}/responses`, { method: "POST", signal: controller.signal, headers: { authorization: `Bearer ${env.AI_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model: env.AI_REVIEW_MODEL, store: false, safety_identifier: contentHash(`orbit-merchant:${input.merchantId}`), reasoning: { effort: env.AI_REVIEW_REASONING_EFFORT, context: "current_turn" }, tools: [{ type: "web_search" }], instructions: "Independently verify only the supplied material merchant claims using public-web sources outside the merchant origin. Do not infer beyond sources. Return INCONCLUSIVE when sources are weak or conflicting. Do not calculate any score or status.", input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(payload) }] }], text: { format: { type: "json_schema", name: "orbit_external_verification", strict: true, schema } }, max_output_tokens: env.AI_MAX_OUTPUT_TOKENS }) });
    const raw = await response.json() as ApiResponse;
    if (!response.ok) throw new Error(raw.error?.message || `External verification returned HTTP ${response.status}.`);
    const parsed = externalResultSchema.parse(JSON.parse(responseText(raw)));
    const citations = citedUrls(raw);
    const merchantOrigin = new URL(input.merchantUrl).origin;
    const allowedClaims = new Map(requests.map((request) => [request.issueKey, request]));
    const retainedResults: ExternalResult["results"] = [];
    for (const result of parsed.results) {
      const request = allowedClaims.get(result.issueKey);
      if (!request || request.merchantClaimEvidenceId !== result.merchantClaimEvidenceId) continue;
      const retainedSources: ExternalResult["results"][number]["sources"] = [];
      for (const source of result.sources.filter((source) => citations.has(source.url) && new URL(source.url).origin !== merchantOrigin)) {
        try {
          const fetched = await safeFetchText(source.url, { maxBytes: 750_000, timeoutMs: env.AI_TIMEOUT_MS, accept: "text/html,text/plain,application/xhtml+xml" });
          if (fetched.status >= 400) continue;
          const page = readablePage(fetched.text);
          if (!page.text) continue;
          await persistArtifactEvidence({ scanId: input.scanId, scope: "EXTERNAL_PUBLIC_WEB", kind: "PAGE_SNAPSHOT", url: fetched.url.toString(), mimeType: fetched.contentType, httpStatus: fetched.status, sha256: contentHash(page.text), metadata: { title: page.title || source.title, citedByExternalRunId: run.id, merchantClaimEvidenceId: result.merchantClaimEvidenceId }, records: [{ evidenceType: "EXTERNAL_PAGE_TEXT", exactText: page.text }] });
          retainedSources.push({ url: fetched.url.toString(), title: page.title || source.title });
        } catch { /* A citation is not retained unless ORBIT independently retrieves it. */ }
      }
      retainedResults.push({ ...result, state: retainedSources.length ? result.state : "INCONCLUSIVE", sources: retainedSources });
    }
    const validated = externalResultSchema.parse({ version: parsed.version, results: retainedResults });
    await db.reviewRun.update({ where: { id: run.id }, data: { status: "COMPLETED", output: validated as unknown as Prisma.InputJsonValue, usage: { inputTokens: raw.usage?.input_tokens ?? 0, outputTokens: raw.usage?.output_tokens ?? 0 }, completedAt: new Date() } });
    return { result: validated, runId: run.id, cached: false };
  } catch (error) {
    await db.reviewRun.update({ where: { id: run.id }, data: { status: "FAILED", error: error instanceof Error ? error.message.slice(0, 2_000) : "Unknown external verification failure", completedAt: new Date() } }).catch(() => undefined);
    throw error;
  } finally { clearTimeout(timeout); }
}
