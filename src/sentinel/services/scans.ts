import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getDatabase } from "@/sentinel/db";
import { enqueueScan } from "@/sentinel/queue";
import { initialProgress } from "./progress";

export const createScanSchema = z.object({ merchantId: z.string().min(1), siteId: z.string().min(1).optional(), mode: z.enum(["FULL", "INCREMENTAL", "QUICK", "TARGETED"]).default("FULL"), targetUrls: z.array(z.string().url()).max(25).optional() });

export async function createScan(input: z.infer<typeof createScanSchema>) {
  const data = createScanSchema.parse(input);
  const db = getDatabase();
  const site = data.siteId ? await db.merchantSite.findFirst({ where: { id: data.siteId, merchantId: data.merchantId } }) : await db.merchantSite.findFirst({ where: { merchantId: data.merchantId, active: true }, orderBy: { createdAt: "asc" } });
  if (!site) throw new Error("No active site was found for this merchant");
  if (data.targetUrls?.length) {
    const registeredSites = await db.merchantSite.findMany({ where: { merchantId: data.merchantId, active: true }, select: { hostname: true } });
    const allowedHosts = new Set(registeredSites.map((item) => item.hostname));
    if (data.targetUrls.some((target) => !allowedHosts.has(new URL(target).hostname.toLowerCase()))) throw new Error("Targeted URLs must belong to an active merchant site");
  }
  const scan = await db.scan.create({ data: { merchantId: data.merchantId, siteId: site.id, mode: data.mode, targetUrls: data.targetUrls, progress: initialProgress() as unknown as Prisma.InputJsonValue } });
  try { await enqueueScan(scan.id); }
  catch (error) {
    await db.scan.update({ where: { id: scan.id }, data: { status: "FAILED", error: error instanceof Error ? error.message : "Queue unavailable" } });
    throw new Error("The scan was created but could not be queued. Confirm that Redis is running.");
  }
  await db.auditLog.create({ data: { organizationId: (await db.merchant.findUniqueOrThrow({ where: { id: data.merchantId }, select: { organizationId: true } })).organizationId, merchantId: data.merchantId, scanId: scan.id, action: "scan.queued", targetType: "Scan", targetId: scan.id, metadata: { mode: data.mode } } });
  return scan;
}
