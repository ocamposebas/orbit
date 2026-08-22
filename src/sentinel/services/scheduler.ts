import { getDatabase } from "@/sentinel/db";
import { enqueueScan } from "@/sentinel/queue";
import { initialProgress } from "./progress";
import type { Prisma } from "@/generated/prisma/client";

export async function enqueueDueMonitors(now = new Date()) {
  const db = getDatabase();
  const sites = await db.merchantSite.findMany({ where: { active: true, monitoringCadenceMinutes: { gte: 60 }, nextScanAt: { lte: now }, merchant: { status: { notIn: ["PAUSED", "BLOCKED"] } } }, take: 100, include: { merchant: { select: { organizationId: true } } } });
  const queued: string[] = [];
  for (const site of sites) {
    const running = await db.scan.findFirst({ where: { siteId: site.id, status: { in: ["QUEUED", "DISCOVERING", "CRAWLING", "CLASSIFYING", "ANALYZING", "EVIDENCE", "SCORING"] } } });
    if (running) continue;
    const scan = await db.scan.create({ data: { merchantId: site.merchantId, siteId: site.id, mode: "INCREMENTAL", progress: initialProgress() as unknown as Prisma.InputJsonValue } });
    await enqueueScan(scan.id);
    await db.merchantSite.update({ where: { id: site.id }, data: { nextScanAt: new Date(now.getTime() + site.monitoringCadenceMinutes * 60_000) } });
    await db.auditLog.create({ data: { organizationId: site.merchant.organizationId, merchantId: site.merchantId, scanId: scan.id, action: "scan.scheduled", targetType: "Scan", targetId: scan.id, metadata: { cadenceMinutes: site.monitoringCadenceMinutes } } });
    queued.push(scan.id);
  }
  return queued;
}
