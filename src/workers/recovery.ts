import { getDatabase } from "@/sentinel/db";
import { logger } from "@/sentinel/logger";
import { queues } from "@/sentinel/queue";
import { updateProgress } from "@/sentinel/services/progress";

const staleAfterMs = 10 * 60_000;

export async function recoverOrphanedScans() {
  const db = getDatabase();
  const scans = await db.scan.findMany({
    where: { status: { in: ["QUEUED", "DISCOVERING", "CRAWLING", "CLASSIFYING", "ANALYZING", "SCORING"] }, updatedAt: { lt: new Date(Date.now() - staleAfterMs) } },
    orderBy: { updatedAt: "asc" },
    take: 25,
    select: { id: true, status: true },
  });

  for (const scan of scans) {
    const analysisStage = ["CLASSIFYING", "ANALYZING", "SCORING"].includes(scan.status);
    const queue = analysisStage ? queues().analysis : queues().crawler;
    const jobName = analysisStage ? "analyze" : "crawl";
    const jobId = `${analysisStage ? "analysis" : "crawl"}-${scan.id}`;
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (["active", "waiting", "delayed", "prioritized", "waiting-children"].includes(state)) continue;
      await existing.remove().catch(() => undefined);
    }
    await queue.add(jobName, { scanId: scan.id }, { jobId });
    await updateProgress(scan.id, { message: `Recovered a stale ${analysisStage ? "analysis" : "crawler"} job` });
    logger.warn({ scanId: scan.id, previousStatus: scan.status, queue: queue.name }, "orphaned scan recovered");
  }
}

const initialRecovery = setTimeout(() => void recoverOrphanedScans().catch((error) => logger.warn({ error }, "initial scan recovery failed")), 15_000);
initialRecovery.unref();
const recoveryTimer = setInterval(() => void recoverOrphanedScans().catch((error) => logger.warn({ error }, "scan recovery failed")), 60_000);
recoveryTimer.unref();
