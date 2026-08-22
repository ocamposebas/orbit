import "dotenv/config";
import { createSentinelWorker } from "./shared";
import { captureFindingEvidence } from "@/sentinel/pipeline/evidence-stage";

createSentinelWorker("evidence", (job) => captureFindingEvidence(String(job.data.findingId)));
