import type { Prisma } from "@/generated/prisma/client";
import { getDatabase } from "@/sentinel/db";
import { logger, serializeErrorForLog } from "@/sentinel/logger";
import { calculateAiScannerScore } from "./scoring";
import { configuredAuditBudget } from "./service";
import { LunaBrowserTools, type LunaBrowserResumeCheckpoint } from "./tools/browser-session";
import { LunaAuditIncompleteError, LunaRateLimitError, LunaUnavailableError, runLunaAudit, type LunaResumeCheckpoint } from "./luna/agent";
import { persistValidatedAudit, validateLunaAudit } from "./validation";
import { runOptionalCritics } from "./critic";
import type { AuditCoverage, AuditUsage } from "./types";
import { investigationCoverageGaps } from "./completeness";
import { enqueueAiScan } from "./queue";
import { getServerEnv } from "@/sentinel/config";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const EMPTY_USAGE: AuditUsage = { responseCalls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0, approximateCostUsd: 0 };

type StoredResumeCheckpoint = {
  version: 1;
  luna: LunaResumeCheckpoint;
  browser: LunaBrowserResumeCheckpoint;
};

function storedResumeCheckpoint(value: Prisma.JsonValue): StoredResumeCheckpoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || !candidate.luna || !candidate.browser) return null;
  return candidate as StoredResumeCheckpoint;
}

export async function runAiScan(scanId: string, request?: typeof fetch) {
  const db = getDatabase();
  const scan = await db.aiScan.findUniqueOrThrow({
    where: { id: scanId },
    include: { merchant: { include: { sites: { where: { active: true } } } }, site: true },
  });
  if (["COMPLETED", "AI_SCAN_FAILED", "AI_SCAN_INCOMPLETE", "CANCELLED"].includes(scan.status)) {
    return { status: scan.status, coverage: scan.coverage, usage: scan.usage, score: scan.score };
  }
  const checkpoint = storedResumeCheckpoint(scan.resumeCheckpoint);
  const startedAt = scan.startedAt ?? new Date();
  const budget = configuredAuditBudget();
  const resumedCoverage = checkpoint ? scan.coverage as unknown as AuditCoverage : null;
  const tools = new LunaBrowserTools(scan.id, new Set(scan.merchant.sites.map((site) => site.hostname)), budget, resumedCoverage, checkpoint?.browser);
  let lunaStarted = false;
  let usage = checkpoint ? { ...checkpoint.luna.usage } : { ...EMPTY_USAGE };
  await db.aiScan.update({ where: { id: scanId }, data: { status: "RUNNING", startedAt, completedAt: null, resumeAfter: null, failureCode: null, error: null } });
  await db.merchant.update({ where: { id: scan.merchantId }, data: { status: "SCANNING" } });
  logger.info({ scanId, merchantId: scan.merchantId, url: scan.site.normalizedUrl, model: scan.model, budget }, "AI Scanner started");
  try {
    await tools.start();
    lunaStarted = true;
    const output = await runLunaAudit({
      scanId,
      merchantId: scan.merchantId,
      merchantName: scan.merchant.businessName,
      merchantUrl: scan.site.normalizedUrl,
      tools,
      request,
      resumeCheckpoint: checkpoint?.luna,
      onCheckpoint: async (luna) => {
        const resumeCheckpoint: StoredResumeCheckpoint = { version: 1, luna, browser: await tools.checkpoint() };
        await db.aiScan.update({ where: { id: scanId }, data: { resumeCheckpoint: json(resumeCheckpoint), coverage: json(tools.coverage()), usage: json(luna.usage) } });
      },
    });
    usage = output.usage;
    const validated = await validateLunaAudit(scanId, output.result);
    await persistValidatedAudit({ scanId, organizationId: scan.merchant.organizationId, merchantId: scan.merchantId, audit: validated.audit });
    await runOptionalCritics(scanId);
    const coverage = tools.coverage();
    const completionGaps = investigationCoverageGaps(coverage, validated.audit.observations.length);
    const enoughInvestigation = completionGaps.length === 0;
    const limitations = enoughInvestigation
      ? validated.audit.limitations
      : [...validated.audit.limitations, `ORBIT did not certify full investigation coverage: ${completionGaps.join("; ")}.`];
    const score = calculateAiScannerScore(validated.audit.findings, coverage, limitations);
    const status = enoughInvestigation ? "COMPLETED" as const : "AI_SCAN_INCOMPLETE" as const;
    const completedAt = new Date();
    await db.aiScan.update({
      where: { id: scanId },
      data: {
        status,
        failureCode: enoughInvestigation ? null : "AI_SCAN_INCOMPLETE",
        error: enoughInvestigation ? null : "AI scan did not complete enough investigation",
        coverage: json(coverage),
        usage: json(usage),
        limitations: json(limitations),
        score: enoughInvestigation ? score.score : null,
        scoreBreakdown: json({ ...score, completionGaps }),
        resumeCheckpoint: json({}),
        resumeAfter: null,
        runtimeMs: coverage.auditRuntimeMs,
        toolCalls: coverage.totalLunaToolCalls,
        completedAt,
      },
    });
    await db.merchantSite.update({ where: { id: scan.siteId }, data: { lastScannedAt: completedAt } });
    const material = validated.audit.findings.some((finding) => finding.materiality === "MATERIAL" && ["CRITICAL", "HIGH"].includes(finding.severity));
    await db.merchant.update({ where: { id: scan.merchantId }, data: { status: material || !enoughInvestigation ? "REVIEW_REQUIRED" : "MONITORED" } });
    await auditCompletion(scanId, scan.merchant.organizationId, scan.merchantId, status, coverage, usage);
    return { status, coverage, usage, score };
  } catch (error) {
    const coverage = tools.coverage();
    usage = coverage.tokenUsage;
    if (error instanceof LunaRateLimitError && scan.resumeCount < getServerEnv().AI_SCANNER_OPENAI_MAX_RESUMES) {
      const resumeCount = scan.resumeCount + 1;
      const resumeAfter = new Date(Date.now() + error.resumeAfterMs);
      await db.aiScan.update({
        where: { id: scanId },
        data: {
          status: "QUEUED",
          failureCode: null,
          error: `Temporary OpenAI ${error.kind.toLowerCase().replaceAll("_", " ")} cooldown; this scan will resume automatically`,
          coverage: json(coverage),
          usage: json(usage),
          runtimeMs: coverage.auditRuntimeMs,
          toolCalls: coverage.totalLunaToolCalls,
          resumeAfter,
          resumeCount,
          completedAt: null,
        },
      });
      await db.auditLog.create({
        data: {
          organizationId: scan.merchant.organizationId,
          merchantId: scan.merchantId,
          aiScanId: scanId,
          action: "ai_scanner.rate_limit_paused",
          targetType: "AiScan",
          targetId: scanId,
          metadata: json({ rateLimitKind: error.kind, retries: error.retries, resumeCount, resumeAfter, coverage, usage }),
        },
      });
      try {
        await enqueueAiScan(scanId, { delayMs: error.resumeAfterMs, resumeCount });
      } catch (queueError) {
        logger.error({ scanId, resumeCount, resumeAfter, error: serializeErrorForLog(queueError) }, "AI Scanner resume could not be scheduled immediately; the due-scan scheduler can recover it");
      }
      logger.warn({ scanId, rateLimitKind: error.kind, resumeCount, resumeAfter, counters: coverage, usage }, "AI Scanner paused at its retained checkpoint for automatic rate-limit continuation");
      return { status: "QUEUED" as const, coverage, usage, resumeAfter };
    }
    const incomplete = lunaStarted && !(error instanceof LunaUnavailableError);
    const status = incomplete ? "AI_SCAN_INCOMPLETE" as const : "AI_SCAN_FAILED" as const;
    const failureCode = incomplete ? "AI_SCAN_INCOMPLETE" as const : "AI_SCAN_FAILED" as const;
    const message = error instanceof LunaRateLimitError
      ? `Temporary OpenAI ${error.kind.toLowerCase().replaceAll("_", " ")} remained active after ${scan.resumeCount} automatic continuation cycles; the retained checkpoint was not discarded`
      : error instanceof Error ? error.message : "AI Scanner failed";
    const completedAt = new Date();
    await db.aiScan.update({
      where: { id: scanId },
      data: { status, failureCode, error: message, coverage: json(coverage), usage: json(usage), limitations: json([message]), runtimeMs: completedAt.getTime() - startedAt.getTime(), toolCalls: coverage.totalLunaToolCalls, completedAt },
    });
    await db.merchant.update({ where: { id: scan.merchantId }, data: { status: "REVIEW_REQUIRED" } });
    await auditCompletion(scanId, scan.merchant.organizationId, scan.merchantId, status, coverage, usage, message);
    logger.error({ scanId, status, error: serializeErrorForLog(error), counters: coverage, usage }, incomplete ? "Luna audit incomplete" : "AI Scanner failed");
    return { status, coverage, usage, error: error instanceof LunaAuditIncompleteError ? error.message : message };
  } finally {
    await tools.close();
  }
}

async function auditCompletion(scanId: string, organizationId: string, merchantId: string, status: string, coverage: AuditCoverage, usage: AuditUsage, error?: string) {
  await getDatabase().auditLog.create({
    data: {
      organizationId,
      merchantId,
      aiScanId: scanId,
      action: status === "COMPLETED" ? "ai_scanner.completed" : status === "AI_SCAN_INCOMPLETE" ? "ai_scanner.incomplete" : "ai_scanner.failed",
      targetType: "AiScan",
      targetId: scanId,
      metadata: json({ status, coverage, usage, error: error ?? null }),
    },
  });
}
