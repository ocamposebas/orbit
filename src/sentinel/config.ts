import { z } from "zod";

const int = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const optionalNonEmpty = z.preprocess((value) => typeof value === "string" && value.trim() === "" ? undefined : value, z.string().trim().min(1).optional());

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().default("postgresql://orbit:orbit@localhost:5432/orbit?schema=public"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  AI_PROVIDER: z.string().default("deterministic"),
  AI_MODEL: z.string().default("local-context-v1"),
  AI_API_KEY: z.string().optional(),
  SCREENSHOT_STORAGE: z.string().default("./storage/evidence"),
  CRAWLER_MAX_PAGES: int(250),
  CRAWLER_MAX_DEPTH: int(4),
  CRAWLER_CONCURRENCY: int(3),
  CRAWLER_RESPONSE_LIMIT_BYTES: int(5_000_000),
  CRAWLER_NAVIGATION_TIMEOUT_MS: int(20_000),
  INTERNAL_JOB_SECRET: z.string().default("development-only"),
  ORBIT_DEMO_MODE: z.enum(["true", "false"]).default(process.env.NODE_ENV === "production" ? "false" : "true").transform((value) => value === "true"),
  SESSION_TTL_DAYS: int(14),
  SEED_ADMIN_EMAIL: z.string().email().default("admin@orbit.local"),
  SEED_ADMIN_PASSWORD: z.string().min(12).optional(),
  STRIPE_SECRET_KEY: optionalNonEmpty,
  STRIPE_MODE: z.enum(["test", "live"]).default("test"),
  STRIPE_CONNECT_ACCOUNT_API: z.enum(["v1", "v2"]).default("v2"),
  STRIPE_CONNECT_WEBHOOK_SECRET: optionalNonEmpty,
  STRIPE_API_VERSION: optionalNonEmpty,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cached ??= serverEnvSchema.parse(process.env);
  return cached;
}
