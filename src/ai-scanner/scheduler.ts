import { getDatabase } from "@/sentinel/db";
import { createAiScan } from "./service";
import { enqueueAiScan } from "./queue";

export async function enqueueDueAiScans(now = new Date()) {
  const resumable = await getDatabase().aiScan.findMany({
    where: { status: "QUEUED", resumeCount: { gt: 0 }, resumeAfter: { lte: now } },
    select: { id: true, resumeCount: true },
    take: 100,
  });
  const queued = new Set<string>();
  for (const scan of resumable) {
    await enqueueAiScan(scan.id, { resumeCount: scan.resumeCount });
    queued.add(scan.id);
  }

  const sites = await getDatabase().merchantSite.findMany({
    where: { active: true, nextScanAt: { lte: now } },
    select: { id: true, merchantId: true, monitoringCadenceMinutes: true },
    take: 100,
  });
  for (const site of sites) {
    const scan = await createAiScan({ merchantId: site.merchantId, siteId: site.id });
    queued.add(scan.id);
    await getDatabase().merchantSite.update({
      where: { id: site.id },
      data: { nextScanAt: new Date(now.getTime() + site.monitoringCadenceMinutes * 60_000) },
    });
  }
  return [...queued];
}
