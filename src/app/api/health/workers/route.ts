import { NextResponse } from "next/server";
import { getAiScannerReadiness } from "@/ai-scanner/worker-readiness";

export const runtime = "nodejs";

export async function GET() {
  try {
    const readiness = await getAiScannerReadiness();
    return NextResponse.json({ status: readiness.ready ? "ok" : "unavailable", ...readiness }, { status: readiness.ready ? 200 : 503 });
  } catch {
    return NextResponse.json({ status: "unavailable", ready: false }, { status: 503 });
  }
}
