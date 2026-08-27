import { Queue, type ConnectionOptions } from "bullmq";
import { getServerEnv } from "@/sentinel/config";
import { AI_SCANNER_QUEUE, AI_SCANNER_VERSION } from "./types";

export function aiScannerRedisConnection(): ConnectionOptions {
  const url = new URL(getServerEnv().REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: Number(url.pathname.slice(1) || 0),
    tls: url.protocol === "rediss:" ? {} : undefined,
  };
}

const globalQueue = globalThis as unknown as { orbitAiScannerQueue?: Queue };

export function aiScannerQueue() {
  globalQueue.orbitAiScannerQueue ??= new Queue(AI_SCANNER_QUEUE, {
    connection: aiScannerRedisConnection(),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 200,
      removeOnFail: 500,
    },
  });
  return globalQueue.orbitAiScannerQueue;
}

export async function enqueueAiScan(scanId: string, options: { delayMs?: number; resumeCount?: number; jobKey?: string } = {}) {
  const resumeCount = options.resumeCount ?? 0;
  const jobKey = options.jobKey?.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
  await aiScannerQueue().add(
    "ai-audit",
    { scanId, version: AI_SCANNER_VERSION, resumeCount },
    {
      jobId: jobKey ? `ai-scan-${scanId}-${jobKey}` : resumeCount > 0 ? `ai-scan-${scanId}-resume-${resumeCount}` : `ai-scan-${scanId}`,
      ...(options.delayMs && options.delayMs > 0 ? { delay: options.delayMs } : {}),
    },
  );
}
