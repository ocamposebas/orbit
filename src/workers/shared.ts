import { Worker, type Job } from "bullmq";
import { pipelineVersion, queueNames, queues, redisConnection } from "@/sentinel/queue";
import { getDatabase } from "@/sentinel/db";
import { logger } from "@/sentinel/logger";
import type { WorkerType } from "@/generated/prisma/client";
import { updateProgress } from "@/sentinel/services/progress";

export function createSentinelWorker(queue: keyof typeof queueNames, handler: (job: Job) => Promise<unknown>) {
  const workerId = `${queue}-${process.pid}`;
  const type = queue.toUpperCase() as WorkerType;
  let currentScanId: string | undefined;
  const worker = new Worker(queueNames[queue], handler, { connection: redisConnection(), concurrency: queue === "crawler" ? 2 : 4, lockDuration: 120_000, stalledInterval: 30_000, maxStalledCount: 2 });
  const heartbeat = async () => { await getDatabase().workerHeartbeat.upsert({ where: { workerId }, update: { type, status: worker.isRunning() ? "ready" : "paused", currentScanId, lastSeenAt: new Date() }, create: { workerId, type, status: "ready", currentScanId } }).catch((error) => logger.warn({ workerId, error }, "worker heartbeat failed")); };
  void heartbeat();
  const timer = setInterval(() => void heartbeat(), 15_000);
  timer.unref();
  worker.on("ready", () => logger.info({ workerId, queue: queueNames[queue], pipelineVersion }, "worker ready"));
  worker.on("active", (job) => { currentScanId = typeof job.data?.scanId === "string" ? job.data.scanId : undefined; void heartbeat(); logger.info({ workerId, queue: queueNames[queue], jobId: job.id, scanId: job.data?.scanId, attempt: job.attemptsMade + 1 }, "job started"); });
  worker.on("completed", (job) => { currentScanId = undefined; void heartbeat(); logger.info({ workerId, jobId: job.id, scanId: job.data?.scanId }, "job completed"); });
  worker.on("failed", async (job, error) => {
    currentScanId = undefined;
    void heartbeat();
    logger.warn({ workerId, queue: queueNames[queue], jobId: job?.id, scanId: job?.data?.scanId, attempt: job?.attemptsMade, maxAttempts: job?.opts.attempts ?? 1, error: error.message }, "job attempt failed");
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await queues().deadLetter.add("failed-job", { queue, jobId: job.id, data: job.data, error: error.message });
      const scanId = typeof job.data?.scanId === "string" ? job.data.scanId : undefined;
      if (scanId) {
        await getDatabase().scan.update({ where: { id: scanId }, data: { status: "FAILED", error: error.message.slice(0, 1_000), completedAt: new Date() } }).catch(() => undefined);
        await updateProgress(scanId, { stage: "failed", message: error.message.slice(0, 500) }).catch(() => undefined);
      }
    }
  });
  worker.on("closed", () => clearInterval(timer));
  const shutdown = () => { clearInterval(timer); void worker.close().catch((error) => logger.warn({ workerId, error }, "worker shutdown failed")); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return worker;
}
