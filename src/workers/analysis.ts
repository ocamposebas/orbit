import "dotenv/config";
import { createSentinelWorker } from "./shared";
import { processAnalysisJob } from "./analysis-handler";

createSentinelWorker("analysis", processAnalysisJob);
