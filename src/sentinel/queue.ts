import { Queue, type ConnectionOptions } from "bullmq";
import { getServerEnv } from "./config";

// Keep this version aligned with material crawler/analysis changes. Queue names
// and worker heartbeats include it so a newly deployed web process cannot send
// scans to workers that are still running an older ruleset.
export const pipelineVersion = "sentinel-pipeline-v3";
export const queueNames = { crawler: `${pipelineVersion}-crawler`, analysis: `${pipelineVersion}-analysis`, evidence: `${pipelineVersion}-evidence`, deadLetter: `${pipelineVersion}-dead-letter` } as const;

export function redisConnection(): ConnectionOptions {
  const url = new URL(getServerEnv().REDIS_URL);
  return { host: url.hostname, port: Number(url.port || 6379), username: url.username || undefined, password: url.password || undefined, db: Number(url.pathname.slice(1) || 0), tls: url.protocol === "rediss:" ? {} : undefined };
}

const globalQueues = globalThis as unknown as { orbitQueues?: Record<keyof typeof queueNames, Queue> };

export function queues() {
  if (!globalQueues.orbitQueues) {
    const connection = redisConnection();
    globalQueues.orbitQueues = {
      crawler: new Queue(queueNames.crawler, { connection, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 2_000 }, removeOnComplete: 200, removeOnFail: 500 } }),
      analysis: new Queue(queueNames.analysis, { connection, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 2_000 }, removeOnComplete: 200, removeOnFail: 500 } }),
      evidence: new Queue(queueNames.evidence, { connection, defaultJobOptions: { attempts: 2, backoff: { type: "exponential", delay: 3_000 }, removeOnComplete: 200, removeOnFail: 500 } }),
      deadLetter: new Queue(queueNames.deadLetter, { connection, defaultJobOptions: { removeOnComplete: 500 } }),
    };
  }
  return globalQueues.orbitQueues;
}

export async function enqueueScan(scanId: string) {
  await queues().crawler.add("crawl", { scanId }, { jobId: `crawl-${scanId}` });
}
