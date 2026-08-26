import type { Job } from "bullmq";
import { runAnalysisStage } from "@/sentinel/pipeline/analysis-stage";

export function createAnalysisJobHandler(run: (scanId: string) => Promise<unknown> = runAnalysisStage) {
  return (job: Pick<Job, "data">) => run(String(job.data.scanId));
}

export const productionAnalysisStage = runAnalysisStage;
export const processAnalysisJob = createAnalysisJobHandler(productionAnalysisStage);
