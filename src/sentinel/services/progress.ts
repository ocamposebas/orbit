import type { ScanProgress } from "@/sentinel/types";
import { getDatabase } from "@/sentinel/db";
import type { Prisma } from "@/generated/prisma/client";
import type { ScanStatus } from "@/generated/prisma/client";
import { pipelineVersion } from "@/sentinel/queue";

const stageOrder: ScanProgress["stage"][] = ["queued", "discovering", "crawling", "classifying", "analyzing", "evidence", "scoring", "completed"];
const statusOrder: ScanStatus[] = ["QUEUED", "DISCOVERING", "CRAWLING", "CLASSIFYING", "ANALYZING", "EVIDENCE", "SCORING", "COMPLETED"];

export function initialProgress(): ScanProgress {
  return { pipelineVersion, stage: "queued", message: "Waiting for an available crawler", urlsFound: 0, pagesProcessed: 0, pagesTotal: 0, productsDetected: 0, productsDiscovered: 0, productsScanned: 0, variantsScanned: 0, imagesDiscovered: 0, imagesAnalyzed: 0, screenshotsAnalyzed: 0, visualPagesAnalyzed: 0, visualCoveragePercent: 0, certificatesDiscovered: 0, certificatesAnalyzed: 0, documentsDiscovered: 0, documentsAnalyzed: 0, documentCoveragePercent: 0, checkoutFlowsInspected: 0, checkoutStatesInspected: 0, semanticPagesAnalyzed: 0, semanticCoveragePercent: 0, inaccessibleAreas: 0, disclaimerPagesObserved: 0, researchRestrictionPagesObserved: 0, researchCoveredProducts: 0, scanCoveragePercent: 0, policiesDetected: 0, claimsInspected: 0, findings: 0, attempt: 0, recoveredPages: 0, stageProcessed: 0, stageTotal: 0, updatedAt: new Date().toISOString() };
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
    productsDiscovered: Math.max(current.productsDiscovered ?? 0, patch.productsDiscovered ?? 0),
    productsScanned: Math.max(current.productsScanned ?? 0, patch.productsScanned ?? 0),
    variantsScanned: Math.max(current.variantsScanned ?? 0, patch.variantsScanned ?? 0),
    imagesDiscovered: Math.max(current.imagesDiscovered ?? 0, patch.imagesDiscovered ?? 0),
    imagesAnalyzed: Math.max(current.imagesAnalyzed ?? 0, patch.imagesAnalyzed ?? 0),
    screenshotsAnalyzed: Math.max(current.screenshotsAnalyzed ?? 0, patch.screenshotsAnalyzed ?? 0),
    visualPagesAnalyzed: Math.max(current.visualPagesAnalyzed ?? 0, patch.visualPagesAnalyzed ?? 0),
    visualCoveragePercent: Math.max(current.visualCoveragePercent ?? 0, patch.visualCoveragePercent ?? 0),
    certificatesDiscovered: Math.max(current.certificatesDiscovered ?? 0, patch.certificatesDiscovered ?? 0),
    certificatesAnalyzed: Math.max(current.certificatesAnalyzed ?? 0, patch.certificatesAnalyzed ?? 0),
    documentsDiscovered: Math.max(current.documentsDiscovered ?? 0, patch.documentsDiscovered ?? 0),
    documentsAnalyzed: Math.max(current.documentsAnalyzed ?? 0, patch.documentsAnalyzed ?? 0),
    documentCoveragePercent: Math.max(current.documentCoveragePercent ?? 0, patch.documentCoveragePercent ?? 0),
    checkoutFlowsInspected: Math.max(current.checkoutFlowsInspected ?? 0, patch.checkoutFlowsInspected ?? 0),
    checkoutStatesInspected: Math.max(current.checkoutStatesInspected ?? 0, patch.checkoutStatesInspected ?? 0),
    semanticPagesAnalyzed: Math.max(current.semanticPagesAnalyzed ?? 0, patch.semanticPagesAnalyzed ?? 0),
    semanticCoveragePercent: Math.max(current.semanticCoveragePercent ?? 0, patch.semanticCoveragePercent ?? 0),
    inaccessibleAreas: Math.max(current.inaccessibleAreas ?? 0, patch.inaccessibleAreas ?? 0),
    disclaimerPagesObserved: Math.max(current.disclaimerPagesObserved ?? 0, patch.disclaimerPagesObserved ?? 0),
    researchRestrictionPagesObserved: Math.max(current.researchRestrictionPagesObserved ?? 0, patch.researchRestrictionPagesObserved ?? 0),
    researchCoveredProducts: Math.max(current.researchCoveredProducts ?? 0, patch.researchCoveredProducts ?? 0),
    scanCoveragePercent: Math.max(current.scanCoveragePercent ?? 0, patch.scanCoveragePercent ?? 0),
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
