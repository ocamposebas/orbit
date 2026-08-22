import Redis from "ioredis";
import type { NextRequest } from "next/server";
import { getServerEnv } from "./config";
import { HttpError } from "./http";

const globalLimiter = globalThis as unknown as { orbitRateLimitRedis?: Redis };
const localWindows = new Map<string, number>();
function client() { globalLimiter.orbitRateLimitRedis ??= new Redis(getServerEnv().REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: true }); return globalLimiter.orbitRateLimitRedis; }

export async function enforceRateLimit(request: NextRequest, scope: string, limit = 30) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "local";
  const window = Math.floor(Date.now() / 60_000);
  const redis = client();
  const key = `orbit:rate:${scope}:${ip}:${window}`;
  let count: number;
  try {
    if (redis.status === "wait") await redis.connect();
    count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 65);
  } catch (error) {
    if (process.env.NODE_ENV === "production") throw error;
    count = (localWindows.get(key) ?? 0) + 1;
    localWindows.set(key, count);
    for (const storedKey of localWindows.keys()) if (!storedKey.endsWith(`:${window}`)) localWindows.delete(storedKey);
  }
  if (count > limit) throw new HttpError(429, "Too many requests. Try again shortly.");
}
