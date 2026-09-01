import type { Prisma } from "@/generated/prisma/client";
import { getDatabase } from "@/sentinel/db";
import { getServerEnv } from "@/sentinel/config";
import { HttpError } from "@/sentinel/http";
import { createAiScanSchema } from "./schemas";
import { enqueueAiScan, removeAutomaticResumeJobs } from "./queue";
import type { AuditBudget } from "./types";
import { randomUUID } from "node:crypto";

export function configuredAuditBudget(): AuditBudget {
  const env = getServerEnv();
  return {
    maximumRuntimeMs: env.AI_SCANNER_MAX_RUNTIME_MS,
    maximumToolCalls: env.AI_SCANNER_MAX_TOOL_CALLS,
    maximumTokens: env.AI_SCANNER_MAX_TOKENS,
    maximumCostUsd: env.AI_SCANNER_MAX_COST_USD,
  };
}

export async function createAiScan(input: unknown) {
  const data = createAiScanSchema.parse(input);
  const db = getDatabase();
  const site = data.siteId
    ? await db.merchantSite.findFirst({ where: { id: data.siteId, merchantId: data.merchantId, active: true } })
    : await db.merchantSite.findFirst({ where: { merchantId: data.merchantId, active: true }, orderBy: { createdAt: "asc" } });
  if (!site) throw new HttpError(400, "No active merchant site is available for AI Scanner");

  const active = await db.aiScan.findFirst({
    where: { siteId: site.id, status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
  });
  if (active) return active;

  const env = getServerEnv();
  const merchant = await db.merchant.findUniqueOrThrow({ where: { id: data.merchantId }, select: { organizationId: true } });
  const scan = await db.aiScan.create({
    data: {
      merchantId: data.merchantId,
      siteId: site.id,
      model: env.AI_SCANNER_MODEL,
      criticModel: env.AI_CRITIC_MODEL,
      budget: configuredAuditBudget() as unknown as Prisma.InputJsonValue,
    },
  });
  try {
    await enqueueAiScan(scan.id);
  } catch (error) {
    await db.aiScan.update({
      where: { id: scan.id },
      data: { status: "AI_SCAN_FAILED", failureCode: "AI_SCAN_FAILED", error: error instanceof Error ? error.message : "Queue unavailable", completedAt: new Date() },
    });
    throw new HttpError(503, "AI Scanner created the audit but Redis could not queue it");
  }
  await db.auditLog.create({
    data: {
      organizationId: merchant.organizationId,
      merchantId: data.merchantId,
      aiScanId: scan.id,
      action: "ai_scanner.started",
      targetType: "AiScan",
      targetId: scan.id,
      metadata: { model: scan.model, queue: "orbit-ai-scanner-v1" },
    },
  });
  return scan;
}

export function hasAiScanResumeCheckpoint(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const checkpoint = value as Record<string, unknown>;
  return checkpoint.version === 1 && Boolean(checkpoint.luna) && Boolean(checkpoint.browser);
}

export async function resumeAiScan(scanId: string, organizationId: string, actorId?: string) {
  const db = getDatabase();
  const scan = await db.aiScan.findFirst({
    where: { id: scanId, merchant: { organizationId } },
    select: { id: true, merchantId: true, status: true, resumeCheckpoint: true, resumeCount: true },
  });
  if (!scan) throw new HttpError(404, "AI scan not found");
  const legacyAutomaticPause = scan.status === "QUEUED" && scan.resumeCount > 0;
  if (scan.status !== "AI_SCAN_INCOMPLETE" && !legacyAutomaticPause) throw new HttpError(409, "Only a paused AI scan can be resumed");
  if (!hasAiScanResumeCheckpoint(scan.resumeCheckpoint)) throw new HttpError(409, "This scan has no retained checkpoint and cannot be resumed in place");

  if (legacyAutomaticPause) {
    const paused = await db.aiScan.updateMany({
      where: { id: scanId, status: "QUEUED", resumeCount: scan.resumeCount },
      data: {
        status: "AI_SCAN_INCOMPLETE",
        failureCode: "AI_SCAN_INCOMPLETE",
        error: "Legacy automatic cooldown converted to manual continuation; the retained checkpoint was not discarded",
        resumeAfter: null,
        completedAt: new Date(),
      },
    });
    if (paused.count !== 1) throw new HttpError(409, "This scan changed state while manual continuation was requested");
    await removeAutomaticResumeJobs(scanId, scan.resumeCount);
  }

  const claimed = await db.aiScan.updateMany({
    where: { id: scanId, status: "AI_SCAN_INCOMPLETE" },
    data: { status: "QUEUED", failureCode: null, error: null, completedAt: null, resumeAfter: null, resumeCount: 0 },
  });
  if (claimed.count !== 1) throw new HttpError(409, "This scan is already being resumed");

  try {
    await enqueueAiScan(scanId, { resumeCount: 0, jobKey: `manual-${randomUUID()}` });
  } catch (error) {
    await db.aiScan.updateMany({
      where: { id: scanId, status: "QUEUED" },
      data: { status: "AI_SCAN_INCOMPLETE", failureCode: "AI_SCAN_INCOMPLETE", error: "Manual resume could not be queued; the retained checkpoint was not discarded", completedAt: new Date(), resumeCount: scan.resumeCount },
    });
    throw new HttpError(503, error instanceof Error ? `Manual resume could not be queued: ${error.message}` : "Manual resume could not be queued");
  }

  await db.merchant.update({ where: { id: scan.merchantId }, data: { status: "SCANNING" } });
  await db.auditLog.create({
    data: {
      organizationId,
      merchantId: scan.merchantId,
      aiScanId: scanId,
      actorId,
      action: "ai_scanner.manual_resume",
      targetType: "AiScan",
      targetId: scanId,
      metadata: { previousStatus: scan.status, previousResumeCount: scan.resumeCount, checkpointRetained: true },
    },
  });
  return { id: scanId, status: "QUEUED" as const, resumeCount: 0, resumeAfter: null };
}

export const aiScanDetailInclude = {
  findings: { include: { evidence: { include: { evidence: true } }, criticReview: true }, orderBy: [{ severity: "asc" as const }, { createdAt: "desc" as const }] },
  products: { orderBy: { createdAt: "desc" as const } },
  toolEvents: { orderBy: { startedAt: "desc" as const }, take: 200 },
  evidence: {
    where: { toolName: "import_manual_report", storageKey: { not: null } },
    orderBy: { capturedAt: "desc" as const },
    select: { id: true, mimeType: true, metadata: true, capturedAt: true },
  },
  merchant: { select: { id: true, businessName: true, industry: true, country: true } },
  site: { select: { id: true, normalizedUrl: true, hostname: true } },
};
