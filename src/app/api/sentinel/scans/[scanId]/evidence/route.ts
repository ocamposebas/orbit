import { NextResponse, type NextRequest } from "next/server";
import { getDatabase } from "@/sentinel/db";
import { requestSession } from "@/sentinel/auth/session";
import { apiError, HttpError, merchantScope } from "@/sentinel/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  try {
    const session = await requestSession(request);
    if (!session) return NextResponse.json({ error: "Authentication is required" }, { status: 401 });
    const { scanId } = await params;
    const scan = await getDatabase().scan.findFirst({ where: { id: scanId, merchant: merchantScope(session) }, select: { id: true } });
    if (!scan) throw new HttpError(404, "Scan not found");
    const scopeInput = request.nextUrl.searchParams.get("scope");
    const scope = scopeInput === "EXTERNAL_PUBLIC_WEB" ? "EXTERNAL_PUBLIC_WEB" as const : scopeInput === "MERCHANT_SITE" ? "MERCHANT_SITE" as const : undefined;
    const limit = Math.min(50, Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 20) || 20));
    const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
    const artifacts = await getDatabase().evidenceArtifact.findMany({ where: { scanId, scope }, orderBy: [{ capturedAt: "asc" }, { id: "asc" }], take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { records: { orderBy: { createdAt: "asc" }, take: 250 } } });
    const hasMore = artifacts.length > limit;
    const items = artifacts.slice(0, limit);
    return NextResponse.json({ evidenceScope: scope ?? "ALL", artifacts: items, nextCursor: hasMore ? items.at(-1)?.id : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
