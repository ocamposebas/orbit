import type { Prisma } from "@/generated/prisma/client";
import { getDatabase } from "@/sentinel/db";
import { getServerEnv } from "@/sentinel/config";
import { HttpError } from "@/sentinel/http";
import { createAiScanSchema } from "./schemas";
import { enqueueAiScan } from "./queue";
import type { AuditBudget } from "./types";

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

export const aiScanDetailInclude = {
  findings: { include: { evidence: { include: { evidence: true } }, criticReview: true }, orderBy: [{ severity: "asc" as const }, { createdAt: "desc" as const }] },
  products: { orderBy: { createdAt: "desc" as const } },
  toolEvents: { orderBy: { startedAt: "desc" as const }, take: 200 },
  evidence: { orderBy: { capturedAt: "desc" as const }, take: 500 },
  merchant: { select: { id: true, businessName: true, industry: true, country: true } },
  site: { select: { id: true, normalizedUrl: true, hostname: true } },
};
