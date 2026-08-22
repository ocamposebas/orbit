import type { WorkerType } from "@/generated/prisma/client";
import { getDatabase } from "@/sentinel/db";
import { pipelineVersion } from "@/sentinel/queue";

const requiredTypes: WorkerType[] = ["CRAWLER", "ANALYSIS", "EVIDENCE"];

export async function getWorkerReadiness() {
  const cutoff = new Date(Date.now() - 45_000);
  const heartbeats = await getDatabase().workerHeartbeat.findMany({ where: { lastSeenAt: { gte: cutoff } }, orderBy: { lastSeenAt: "desc" }, select: { type: true, status: true, metadata: true, lastSeenAt: true } });
  const current = heartbeats.filter((heartbeat) => {
    const metadata = heartbeat.metadata as { pipelineVersion?: string } | null;
    return metadata?.pipelineVersion === pipelineVersion && heartbeat.status === "ready";
  });
  const workers = Object.fromEntries(requiredTypes.map((type) => {
    const heartbeat = current.find((item) => item.type === type);
    return [type.toLowerCase(), { ready: Boolean(heartbeat), lastSeenAt: heartbeat?.lastSeenAt.toISOString() ?? null }];
  })) as Record<Lowercase<WorkerType>, { ready: boolean; lastSeenAt: string | null }>;
  return { ready: requiredTypes.every((type) => workers[type.toLowerCase() as Lowercase<WorkerType>].ready), pipelineVersion, workers };
}
