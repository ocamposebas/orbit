import type { Prisma } from "@/generated/prisma/client";
import { getDatabase } from "@/sentinel/db";
import { logger, serializeErrorForLog } from "@/sentinel/logger";
import { calculateAiScannerScore } from "./scoring";
import { configuredAuditBudget } from "./service";
import { LunaBrowserTools } from "./tools/browser-session";
import { LunaAuditIncompleteError, LunaUnavailableError, runLunaAudit } from "./luna/agent";
import { persistValidatedAudit, validateLunaAudit } from "./validation";
import { runOptionalCritics } from "./critic";
import type { AuditCoverage, AuditUsage } from "./types";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const EMPTY_USAGE: AuditUsage = { responseCalls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0, approximateCostUsd: 0 };

export async function runAiScan(scanId: string, request?: typeof fetch) {
  const db = getDatabase();
  const scan = await db.aiScan.findUniqueOrThrow({
    where: { id: scanId },
    include: { merchant: { include: { sites: { where: { active: true } } } }, site: true },
  });
  const startedAt = new Date();
  const budget = configuredAuditBudget();
  const tools = new LunaBrowserTools(scan.id, new Set(scan.merchant.sites.map((site) => site.hostname)), budget);
  let lunaStarted = false;
  let usage = { ...EMPTY_USAGE };
  await db.aiScan.update({ where: { id: scanId }, data: { status: "RUNNING", startedAt, completedAt: null, failureCode: null, error: null } });
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
    });
    usage = output.usage;
    const validated = await validateLunaAudit(scanId, output.result);
    await persistValidatedAudit({ scanId, organizationId: scan.merchant.organizationId, merchantId: scan.merchantId, audit: validated.audit });
    await runOptionalCritics(scanId);
    const coverage = tools.coverage();
    const enoughInvestigation = coverage.pagesOpened.length > 0
      && coverage.pagesVisuallyReviewed.length > 0
      && coverage.visualRegionsInspected > 0
      && coverage.totalLunaToolCalls >= 3
      && validated.audit.observations.length > 0;
    const limitations = enoughInvestigation
      ? validated.audit.limitations
      : [...validated.audit.limitations, "Luna returned before completing a substantive rendered-page, visual, and follow-up investigation."];
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
        score: score.score,
        scoreBreakdown: json(score),
        runtimeMs: completedAt.getTime() - startedAt.getTime(),
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
    const incomplete = lunaStarted && !(error instanceof LunaUnavailableError);
    const status = incomplete ? "AI_SCAN_INCOMPLETE" as const : "AI_SCAN_FAILED" as const;
    const failureCode = incomplete ? "AI_SCAN_INCOMPLETE" as const : "AI_SCAN_FAILED" as const;
    const message = error instanceof Error ? error.message : "AI Scanner failed";
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
