import { NextResponse, type NextRequest } from "next/server";
import { createAiScan } from "@/ai-scanner/service";
import { getAiScannerReadiness } from "@/ai-scanner/worker-readiness";
import { getDatabase } from "@/sentinel/db";
import { apiError, merchantScope, requireRole } from "@/sentinel/http";
import { requestSession } from "@/sentinel/auth/session";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit(request, "ai-scanner-create", 20);
    const organization = await requireRole(request, ["OWNER", "ADMIN", "ANALYST"]);
    const input = await request.json();
    const merchantId = typeof input?.merchantId === "string" ? input.merchantId : "";
    const merchant = await getDatabase().merchant.findFirst({ where: { id: merchantId, organizationId: organization.id }, select: { id: true } });
    if (!merchant) return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    const scan = await createAiScan(input);
    return NextResponse.json({ scan, readiness: await getAiScannerReadiness() }, { status: scan.status === "QUEUED" ? 202 : 200 });
  } catch (error) { return apiError(error); }
}

export async function GET(request: NextRequest) {
  try {
    const session = await requestSession(request);
    if (!session) return NextResponse.json({ error: "Authentication is required" }, { status: 401 });
    const scans = await getDatabase().aiScan.findMany({
      where: { merchant: merchantScope(session) },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { merchant: { select: { id: true, businessName: true } }, site: { select: { hostname: true } } },
    });
    return NextResponse.json({ scans });
  } catch (error) { return apiError(error); }
}
