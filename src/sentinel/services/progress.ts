import type { ScanProgress } from "@/sentinel/types";
import { getDatabase } from "@/sentinel/db";
import type { Prisma } from "@/generated/prisma/client";

export function initialProgress(): ScanProgress {
  return { stage: "queued", message: "Waiting for an available crawler", urlsFound: 0, pagesProcessed: 0, pagesTotal: 0, productsDetected: 0, policiesDetected: 0, claimsInspected: 0, findings: 0, updatedAt: new Date().toISOString() };
}

export async function updateProgress(scanId: string, patch: Partial<ScanProgress>) {
  const db = getDatabase();
  const scan = await db.scan.findUniqueOrThrow({ where: { id: scanId }, select: { progress: true } });
  const current = (scan.progress ?? {}) as unknown as ScanProgress;
  const progress: ScanProgress = { ...initialProgress(), ...current, ...patch, updatedAt: new Date().toISOString() };
  await db.scan.update({ where: { id: scanId }, data: { progress: progress as unknown as Prisma.InputJsonValue } });
  return progress;
}
