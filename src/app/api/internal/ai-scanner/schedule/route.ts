import { NextResponse, type NextRequest } from "next/server";
import { enqueueDueAiScans } from "@/ai-scanner/scheduler";
import { getServerEnv } from "@/sentinel/config";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${getServerEnv().INTERNAL_JOB_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scanIds = await enqueueDueAiScans();
  return NextResponse.json({ queued: scanIds.length, scanIds });
}
