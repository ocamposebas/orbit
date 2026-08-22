import { NextResponse, type NextRequest } from "next/server";
import { apiError, HttpError, requireRole } from "@/sentinel/http";
import { createScan, createScanSchema } from "@/sentinel/services/scans";
import { getDatabase } from "@/sentinel/db";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { getWorkerReadiness } from "@/sentinel/services/worker-readiness";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit(request, "scan-create", 20);
    const organization = await requireRole(request, ["OWNER", "ADMIN", "ANALYST"]);
    const input = createScanSchema.parse(await request.json());
    const merchant = await getDatabase().merchant.findFirst({ where: { id: input.merchantId, organizationId: organization.id }, select: { id: true } });
    if (!merchant) throw new HttpError(404, "Merchant not found");
    const readiness = await getWorkerReadiness();
    if (!readiness.workers.crawler.ready) throw new HttpError(503, `Crawler ${readiness.pipelineVersion} is not ready. Deploy or restart the worker service before starting a scan.`);
    const scan = await createScan(input);
    return NextResponse.json({ scan }, { status: 202 });
  } catch (error) { return apiError(error); }
}
