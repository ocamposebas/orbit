import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/sentinel/config";
import { scheduleMonthlyStatements } from "@/statements/scheduler";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${getServerEnv().INTERNAL_JOB_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await scheduleMonthlyStatements());
}
