import { randomUUID } from "node:crypto";
import { getServerEnv } from "@/sentinel/config";
import { monthlyGenerationIsDue, previousCalendarMonth } from "./period";
import { enqueueMonthlyStatementGeneration } from "./queue";

export async function scheduleMonthlyStatements(now = new Date()) {
  const env = getServerEnv();
  if (!env.STATEMENTS_ENABLED || !monthlyGenerationIsDue(now, env.STATEMENT_TIMEZONE, env.STATEMENT_GENERATION_DAY, env.STATEMENT_GENERATION_HOUR)) return { queued: false, reason: "not_due" as const };
  const period = previousCalendarMonth(now, env.STATEMENT_TIMEZONE);
  const job = await enqueueMonthlyStatementGeneration({ year: period.year, month: period.month, scheduledAt: now.toISOString() });
  return { queued: true, jobId: job.id, jobRunId: randomUUID(), year: period.year, month: period.month };
}

