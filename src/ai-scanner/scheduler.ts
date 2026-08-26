import { getDatabase } from "@/sentinel/db";
import { createAiScan } from "./service";

export async function enqueueDueAiScans(now = new Date()) {
  const sites = await getDatabase().merchantSite.findMany({
    where: { active: true, nextScanAt: { lte: now } },
    select: { id: true, merchantId: true, monitoringCadenceMinutes: true },
    take: 100,
  });
  const queued: string[] = [];
  for (const site of sites) {
    const scan = await createAiScan({ merchantId: site.merchantId, siteId: site.id });
    queued.push(scan.id);
    await getDatabase().merchantSite.update({
      where: { id: site.id },
      data: { nextScanAt: new Date(now.getTime() + site.monitoringCadenceMinutes * 60_000) },
    });
  }
  return queued;
}
