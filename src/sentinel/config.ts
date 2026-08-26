import { z } from "zod";

const int = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const nonNegative = (fallback: number) => z.coerce.number().min(0).default(fallback);
const optionalNonEmpty = z.preprocess((value) => typeof value === "string" && value.trim() === "" ? undefined : value, z.string().trim().min(1).optional());

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().default("postgresql://orbit:orbit@localhost:5432/orbit?schema=public"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  AI_SCANNER_MODEL: z.string().default("gpt-5.6-luna"),
  AI_CRITIC_MODEL: optionalNonEmpty,
  AI_SCANNER_REASONING_EFFORT: z.enum(["none", "low", "medium", "high", "xhigh", "max"]).default("high"),
  OPENAI_API_KEY: optionalNonEmpty,
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  AI_SCANNER_REQUEST_TIMEOUT_MS: int(60_000),
  AI_SCANNER_MAX_RUNTIME_MS: int(900_000),
  AI_SCANNER_MAX_TOOL_CALLS: int(120),
  AI_SCANNER_MAX_TOKENS: int(500_000),
  AI_SCANNER_MAX_COST_USD: nonNegative(25),
  AI_SCANNER_MAX_OUTPUT_TOKENS: int(16_000),
  AI_SCANNER_MAX_EVIDENCE_BYTES: int(5_000_000),
  AI_SCANNER_INPUT_COST_PER_MILLION: nonNegative(0.2),
  AI_SCANNER_OUTPUT_COST_PER_MILLION: nonNegative(1.2),
  AI_SCANNER_BROWSER_HEADLESS: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  SCREENSHOT_STORAGE: z.string().default("./storage/evidence"),
  INTERNAL_JOB_SECRET: z.string().default("development-only"),
  ORBIT_SECRET_ENCRYPTION_KEY: optionalNonEmpty,
  ORBIT_DEMO_MODE: z.enum(["true", "false"]).default(process.env.NODE_ENV === "production" ? "false" : "true").transform((value) => value === "true"),
  SESSION_TTL_DAYS: int(14),
  SEED_ADMIN_EMAIL: z.string().email().default("admin@orbit.local"),
  SEED_ADMIN_PASSWORD: z.string().min(12).optional(),
  STRIPE_SECRET_KEY: optionalNonEmpty,
  STRIPE_PUBLISHABLE_KEY: optionalNonEmpty,
  STRIPE_MODE: z.enum(["test", "live"]).default("test"),
  STRIPE_CONNECT_ACCOUNT_API: z.enum(["v1", "v2"]).default("v2"),
  STRIPE_CONNECT_WEBHOOK_SECRET: optionalNonEmpty,
  STRIPE_PAYMENTS_WEBHOOK_SECRET: optionalNonEmpty,
  STRIPE_API_VERSION: optionalNonEmpty,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cached ??= serverEnvSchema.parse(process.env);
  return cached;
}
