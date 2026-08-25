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
    const [reviewRuns, verifierAssertions, adjudicationDecisions] = await Promise.all([
      getDatabase().reviewRun.findMany({ where: { scanId }, orderBy: { createdAt: "asc" }, include: { observations: { include: { evidence: true }, orderBy: { createdAt: "asc" } } } }),
      getDatabase().verificationAssertion.findMany({ where: { scanId }, include: { evidence: true }, orderBy: [{ factType: "asc" }, { issueKey: "asc" }] }),
      getDatabase().adjudicationDecision.findMany({ where: { scanId }, orderBy: { createdAt: "asc" } }),
    ]);
    return NextResponse.json({ reviewRuns, verifierAssertions, adjudicationDecisions, scoreAuthority: "deterministic" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
