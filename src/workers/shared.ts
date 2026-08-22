import { Worker, type Job } from "bullmq";
import { queueNames, queues, redisConnection } from "@/sentinel/queue";
import { getDatabase } from "@/sentinel/db";
import { logger } from "@/sentinel/logger";
import type { WorkerType } from "@/generated/prisma/client";

export function createSentinelWorker(queue: keyof typeof queueNames, handler: (job: Job) => Promise<unknown>) {
  const workerId = `${queue}-${process.pid}`;
  const type = queue.toUpperCase() as WorkerType;
  const worker = new Worker(queueNames[queue], handler, { connection: redisConnection(), concurrency: queue === "crawler" ? 2 : 4 });
  const heartbeat = async () => { await getDatabase().workerHeartbeat.upsert({ where: { workerId }, update: { type, status: worker.isRunning() ? "ready" : "paused", lastSeenAt: new Date() }, create: { workerId, type, status: "ready" } }).catch((error) => logger.warn({ workerId, error }, "worker heartbeat failed")); };
  void heartbeat();
  const timer = setInterval(() => void heartbeat(), 15_000);
  timer.unref();
  worker.on("ready", () => logger.info({ workerId, queue: queueNames[queue] }, "worker ready"));
  worker.on("completed", (job) => logger.info({ workerId, jobId: job.id, scanId: job.data?.scanId }, "job completed"));
  worker.on("failed", async (job, error) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await queues().deadLetter.add("failed-job", { queue, jobId: job.id, data: job.data, error: error.message });
      const scanId = typeof job.data?.scanId === "string" ? job.data.scanId : undefined;
      if (scanId) await getDatabase().scan.update({ where: { id: scanId }, data: { status: "FAILED", error: error.message.slice(0, 1_000), completedAt: new Date() } }).catch(() => undefined);
    }
  });
  worker.on("closed", () => clearInterval(timer));
  return worker;
}
