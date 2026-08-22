import { NextResponse } from "next/server";
import { getDatabase } from "@/sentinel/db";

export const runtime = "nodejs";
export async function GET() { const started = Date.now(); try { await getDatabase().$queryRaw`SELECT 1`; return NextResponse.json({ status: "ok", latencyMs: Date.now() - started }); } catch { return NextResponse.json({ status: "unavailable", latencyMs: Date.now() - started }, { status: 503 }); } }
