import { Worker, type Job } from "bullmq";
import { aiScannerRedisConnection } from "@/ai-scanner/queue";
import { runAiScan } from "@/ai-scanner/run";
import { AI_SCANNER_QUEUE, AI_SCANNER_VERSION } from "@/ai-scanner/types";
import { getDatabase } from "@/sentinel/db";
import { logger, serializeErrorForLog } from "@/sentinel/logger";

const workerId = `ai-scanner-${process.pid}`;
let currentScanId: string | undefined;

const worker = new Worker(AI_SCANNER_QUEUE, async (job: Job<{ scanId: string }>) => runAiScan(job.data.scanId), {
  connection: aiScannerRedisConnection(),
  concurrency: 1,
  lockDuration: 20 * 60_000,
  stalledInterval: 30_000,
  maxStalledCount: 1,
});

async function heartbeat() {
  await getDatabase().workerHeartbeat.upsert({
    where: { workerId },
    update: { type: "AI_SCANNER", status: worker.isRunning() ? "ready" : "paused", currentScanId, metadata: { scannerVersion: AI_SCANNER_VERSION, queue: AI_SCANNER_QUEUE }, lastSeenAt: new Date() },
    create: { workerId, type: "AI_SCANNER", status: "ready", currentScanId, metadata: { scannerVersion: AI_SCANNER_VERSION, queue: AI_SCANNER_QUEUE } },
  }).catch((error) => logger.warn({ workerId, error: serializeErrorForLog(error) }, "AI Scanner worker heartbeat failed"));
}

void heartbeat();
const timer = setInterval(() => void heartbeat(), 15_000);
timer.unref();
worker.on("ready", () => { void heartbeat(); logger.info({ workerId, queue: AI_SCANNER_QUEUE, scannerVersion: AI_SCANNER_VERSION }, "AI Scanner worker ready"); });
worker.on("active", (job) => { currentScanId = job.data.scanId; void heartbeat(); logger.info({ workerId, jobId: job.id, scanId: job.data.scanId }, "AI Scanner job active"); });
worker.on("completed", (job) => { currentScanId = undefined; void heartbeat(); logger.info({ workerId, jobId: job.id, scanId: job.data.scanId }, "AI Scanner job completed"); });
worker.on("failed", (job, error) => { currentScanId = undefined; void heartbeat(); logger.error({ workerId, jobId: job?.id, scanId: job?.data.scanId, error: serializeErrorForLog(error) }, "AI Scanner job failed"); });
worker.on("closed", () => clearInterval(timer));

function shutdown() {
  clearInterval(timer);
  void worker.close().catch((error) => logger.warn({ workerId, error: serializeErrorForLog(error) }, "AI Scanner worker shutdown failed"));
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
