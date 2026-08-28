import Redis from "ioredis";
import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { getServerEnv } from "./config";
import { HttpError } from "./http";
import { childLogger } from "./logger";

const globalLimiter = globalThis as unknown as { orbitRateLimitRedis?: Redis };
const localWindows = new Map<string, number>();
const log = childLogger({ component: "rate-limit" });
function client() { globalLimiter.orbitRateLimitRedis ??= new Redis(getServerEnv().REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: true }); return globalLimiter.orbitRateLimitRedis; }

function keyPart(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export async function enforceRateLimit(request: NextRequest, scope: string, limit = 30, subject?: string) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "local";
  const window = Math.floor(Date.now() / 60_000);
  const redis = client();
  const discriminator = subject ? `subject:${keyPart(subject)}` : `ip:${keyPart(ip)}`;
  const key = `orbit:rate:${scope}:${discriminator}:${window}`;
  let count: number;
  try {
    if (redis.status === "wait") await redis.connect();
    count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 65);
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      log.error({ scope, limiter: subject ? "subject" : "ip", error }, "Redis rate limiter is unavailable");
      throw new HttpError(503, "Payment traffic protection is temporarily unavailable. Please retry shortly.");
    }
    count = (localWindows.get(key) ?? 0) + 1;
    localWindows.set(key, count);
    for (const storedKey of localWindows.keys()) if (!storedKey.endsWith(`:${window}`)) localWindows.delete(storedKey);
  }
  if (count > limit) throw new HttpError(429, "Too many requests. Try again shortly.");
}
