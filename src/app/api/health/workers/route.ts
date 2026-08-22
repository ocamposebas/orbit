import { NextResponse } from "next/server";
import { getWorkerReadiness } from "@/sentinel/services/worker-readiness";

export const runtime = "nodejs";

export async function GET() {
  try {
    const readiness = await getWorkerReadiness();
    return NextResponse.json({ status: readiness.ready ? "ok" : "unavailable", ...readiness }, { status: readiness.ready ? 200 : 503 });
  } catch {
    return NextResponse.json({ status: "unavailable", ready: false }, { status: 503 });
  }
}
