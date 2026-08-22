import type { ScanProgress } from "@/sentinel/types";
import { getDatabase } from "@/sentinel/db";
import type { Prisma } from "@/generated/prisma/client";
import type { ScanStatus } from "@/generated/prisma/client";
import { pipelineVersion } from "@/sentinel/queue";

const stageOrder: ScanProgress["stage"][] = ["queued", "discovering", "crawling", "classifying", "analyzing", "evidence", "scoring", "completed"];
const statusOrder: ScanStatus[] = ["QUEUED", "DISCOVERING", "CRAWLING", "CLASSIFYING", "ANALYZING", "EVIDENCE", "SCORING", "COMPLETED"];

export function initialProgress(): ScanProgress {
  return { pipelineVersion, stage: "queued", message: "Waiting for an available crawler", urlsFound: 0, pagesProcessed: 0, pagesTotal: 0, productsDetected: 0, policiesDetected: 0, claimsInspected: 0, findings: 0, attempt: 0, recoveredPages: 0, stageProcessed: 0, stageTotal: 0, updatedAt: new Date().toISOString() };
}

export function mergeProgress(current: Partial<ScanProgress>, patch: Partial<ScanProgress>, updatedAt = new Date().toISOString()): ScanProgress {
  const currentStage = current.stage ?? "queued";
  const requestedStage = patch.stage ?? currentStage;
  const stage = requestedStage === "failed" || stageOrder.indexOf(requestedStage) >= stageOrder.indexOf(currentStage) ? requestedStage : currentStage;
  const keepCurrentStageCounters = stage === currentStage && requestedStage !== currentStage;
  const progress: ScanProgress = {
    ...initialProgress(),
    ...current,
    ...patch,
    pipelineVersion,
    stage,
    urlsFound: Math.max(current.urlsFound ?? 0, patch.urlsFound ?? 0),
    pagesProcessed: Math.max(current.pagesProcessed ?? 0, patch.pagesProcessed ?? 0),
    pagesTotal: Math.max(current.pagesTotal ?? 0, patch.pagesTotal ?? 0),
    productsDetected: Math.max(current.productsDetected ?? 0, patch.productsDetected ?? 0),
    policiesDetected: Math.max(current.policiesDetected ?? 0, patch.policiesDetected ?? 0),
    claimsInspected: Math.max(current.claimsInspected ?? 0, patch.claimsInspected ?? 0),
    findings: Math.max(current.findings ?? 0, patch.findings ?? 0),
    attempt: Math.max(current.attempt ?? 0, patch.attempt ?? 0),
    recoveredPages: Math.max(current.recoveredPages ?? 0, patch.recoveredPages ?? 0),
    stageProcessed: keepCurrentStageCounters ? current.stageProcessed ?? 0 : patch.stageProcessed ?? (stage === currentStage ? current.stageProcessed ?? 0 : 0),
    stageTotal: keepCurrentStageCounters ? current.stageTotal ?? 0 : patch.stageTotal ?? (stage === currentStage ? current.stageTotal ?? 0 : 0),
    updatedAt,
  };
  return progress;
}

export async function updateProgress(scanId: string, patch: Partial<ScanProgress>) {
  const db = getDatabase();
  const scan = await db.scan.findUniqueOrThrow({ where: { id: scanId }, select: { progress: true } });
  const current = (scan.progress ?? {}) as unknown as Partial<ScanProgress>;
  const progress = mergeProgress(current, patch);
  await db.scan.update({ where: { id: scanId }, data: { progress: progress as unknown as Prisma.InputJsonValue } });
  return progress;
}

export async function advanceScanStatus(scanId: string, requested: ScanStatus, data: Prisma.ScanUpdateInput = {}) {
  const db = getDatabase();
  const scan = await db.scan.findUniqueOrThrow({ where: { id: scanId }, select: { status: true } });
  const currentRank = statusOrder.indexOf(scan.status);
  const requestedRank = statusOrder.indexOf(requested);
  const status = scan.status === "FAILED" || scan.status === "CANCELLED" || currentRank > requestedRank ? scan.status : requested;
  return db.scan.update({ where: { id: scanId }, data: { ...data, status } });
}
