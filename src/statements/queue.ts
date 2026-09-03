import { Queue } from "bullmq";
import { aiScannerRedisConnection } from "@/ai-scanner/queue";

export const STATEMENT_QUEUE = "orbit-merchant-statements-v1";
const globalQueue = globalThis as unknown as { orbitStatementQueue?: Queue };

export function statementQueue() {
  globalQueue.orbitStatementQueue ??= new Queue(STATEMENT_QUEUE, { connection: aiScannerRedisConnection(), defaultJobOptions: { removeOnComplete: 500, removeOnFail: 500 } });
  return globalQueue.orbitStatementQueue;
}

export async function enqueueMonthlyStatementGeneration(input: { year: number; month: number; scheduledAt: string }) {
  return statementQueue().add("generate-month", input, { jobId: `statements-${input.year}-${String(input.month).padStart(2, "0")}` });
}

export async function enqueueStatementEmail(statementId: string, attempt = 1, delay = 0, resentByActorId?: string, requestId?: string) {
  return statementQueue().add("send-email", { statementId, attempt, resentByActorId, requestId }, { jobId: `statement-email-${statementId}-${attempt}-${resentByActorId ? Date.now() : "auto"}`, delay });
}

