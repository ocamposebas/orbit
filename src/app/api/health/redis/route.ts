import { NextResponse } from "next/server";
import Redis from "ioredis";
import { getServerEnv } from "@/sentinel/config";

export const runtime = "nodejs";
export async function GET() { const started = Date.now(); const redis = new Redis(getServerEnv().REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2_000 }); try { await redis.connect(); await redis.ping(); return NextResponse.json({ status: "ok", latencyMs: Date.now() - started }); } catch { return NextResponse.json({ status: "unavailable", latencyMs: Date.now() - started }, { status: 503 }); } finally { redis.disconnect(); } }
