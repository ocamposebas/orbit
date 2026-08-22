import "dotenv/config";
import { createSentinelWorker } from "./shared";
import { runCrawlStage } from "@/sentinel/pipeline/crawl-stage";
import { queues } from "@/sentinel/queue";

createSentinelWorker("crawler", async (job) => {
  const scanId = String(job.data.scanId);
  await runCrawlStage(scanId);
  await queues().analysis.add("analyze", { scanId }, { jobId: `analysis-${scanId}` });
});
