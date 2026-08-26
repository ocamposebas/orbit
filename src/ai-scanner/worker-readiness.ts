import { getDatabase } from "@/sentinel/db";
import { AI_SCANNER_VERSION } from "./types";

export async function getAiScannerReadiness() {
  const cutoff = new Date(Date.now() - 45_000);
  const heartbeat = await getDatabase().workerHeartbeat.findFirst({
    where: { type: "AI_SCANNER", status: "ready", lastSeenAt: { gte: cutoff } },
    orderBy: { lastSeenAt: "desc" },
    select: { lastSeenAt: true, metadata: true },
  });
  const metadata = heartbeat?.metadata as { scannerVersion?: string } | undefined;
  const ready = metadata?.scannerVersion === AI_SCANNER_VERSION;
  return {
    ready,
    scannerVersion: AI_SCANNER_VERSION,
    worker: { ready, lastSeenAt: ready ? heartbeat?.lastSeenAt.toISOString() ?? null : null },
  };
}
