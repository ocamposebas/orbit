import "dotenv/config";
import { createSentinelWorker } from "./shared";
import { runAnalysisStage } from "@/sentinel/pipeline/analysis-stage";

createSentinelWorker("analysis", (job) => runAnalysisStage(String(job.data.scanId)));
