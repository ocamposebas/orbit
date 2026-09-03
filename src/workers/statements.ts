import { randomUUID } from "node:crypto";
import { Worker, type Job } from "bullmq";
import { aiScannerRedisConnection } from "@/ai-scanner/queue";
import { getDatabase } from "@/sentinel/db";
import { logger, serializeErrorForLog } from "@/sentinel/logger";
import { sendStatementEmail } from "@/statements/email";
import { enqueueStatementEmail, STATEMENT_QUEUE } from "@/statements/queue";
import { generateMerchantStatements } from "@/statements/service";
import { validateStatementEmailConfiguration } from "@/sentinel/config";

type GenerateData = { year: number; month: number; scheduledAt: string };
type EmailData = { statementId: string; attempt: number; resentByActorId?: string; requestId?: string };
const retryDelay = [0, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
const workerId = `statements-${process.pid}`;
validateStatementEmailConfiguration();

const worker = new Worker(STATEMENT_QUEUE, async (job: Job<GenerateData | EmailData>) => {
  if (job.name === "send-email") {
    const data = job.data as EmailData;
    const result = await sendStatementEmail(data.statementId, { resentByActorId: data.resentByActorId, requestId: data.requestId });
    if (!result.sent && result.attempt < 4) await enqueueStatementEmail(data.statementId, result.attempt + 1, retryDelay[result.attempt], data.resentByActorId, data.requestId);
    return result;
  }
  const data = job.data as GenerateData;
  const jobRunId = String(job.id ?? randomUUID());
  const merchants = await getDatabase().merchant.findMany({ where: { status: { in: ["READY", "MONITORED"] }, portalEnabled: true, stripeConnect: { isNot: null } }, select: { id: true, organizationId: true, monthlyStatementEmailEnabled: true } });
  const generated: string[] = [];
  for (const merchant of merchants) {
    try {
      const result = await generateMerchantStatements({ merchantId: merchant.id, year: data.year, month: data.month, requestId: jobRunId });
      for (const item of result.results) if ("statement" in item && item.statement?.status === "FINALIZED") {
        generated.push(item.statement.id);
        if (merchant.monthlyStatementEmailEnabled && item.statement.emailStatus !== "SENT") {
          await enqueueStatementEmail(item.statement.id);
          const statement = item.statement;
          await getDatabase().auditLog.create({ data: { organizationId: merchant.organizationId, merchantId: statement.merchantId, action: "STATEMENT_EMAIL_QUEUED", targetType: "MerchantStatement", targetId: statement.id, metadata: { automatic: true } } });
        }
      }
    } catch (error) {
      logger.error({ component: "statements", merchantId: merchant.id, period: `${data.year}-${data.month}`, jobRunId, error: serializeErrorForLog(error) }, "Monthly statement generation failed");
    }
  }
  return { generated };
}, { connection: aiScannerRedisConnection(), concurrency: 2, lockDuration: 10 * 60_000 });

async function heartbeat() {
  await getDatabase().workerHeartbeat.upsert({ where: { workerId }, update: { type: "STATEMENTS", status: worker.isRunning() ? "ready" : "paused", metadata: { queue: STATEMENT_QUEUE }, lastSeenAt: new Date() }, create: { workerId, type: "STATEMENTS", status: "ready", metadata: { queue: STATEMENT_QUEUE } } }).catch(() => undefined);
}
void heartbeat();
const timer = setInterval(() => void heartbeat(), 15_000); timer.unref();
worker.on("failed", (job, error) => logger.error({ component: "statements", jobId: job?.id, error: serializeErrorForLog(error) }, "Statement worker job failed"));
worker.on("closed", () => clearInterval(timer));
function shutdown() { clearInterval(timer); void worker.close(); }
process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
