import { NextResponse, type NextRequest } from "next/server";
import { resumeAiScan } from "@/ai-scanner/service";
import { requestSession } from "@/sentinel/auth/session";
import { apiError, HttpError, validateMutationOrigin } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  try {
    await enforceRateLimit(request, "ai-scanner-manual-resume", 12);
    const session = await requestSession(request);
    if (!session) throw new HttpError(401, "Authentication is required");
    if (!["OWNER", "ADMIN", "ANALYST"].includes(session.role)) throw new HttpError(403, "This role cannot resume an AI scan");
    validateMutationOrigin(request);
    const { scanId } = await params;
    const scan = await resumeAiScan(scanId, session.organization.id, session.user.id);
    return NextResponse.json({ scan }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
