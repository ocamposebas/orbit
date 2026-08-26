import { z } from "zod";

const int = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const nonNegative = (fallback: number) => z.coerce.number().min(0).default(fallback);
const optionalNonNegative = z.preprocess((value) => value === "" || value === undefined ? undefined : value, z.coerce.number().min(0).optional());
const optionalNonEmpty = z.preprocess((value) => typeof value === "string" && value.trim() === "" ? undefined : value, z.string().trim().min(1).optional());

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().default("postgresql://orbit:orbit@localhost:5432/orbit?schema=public"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  AI_PROVIDER: z.enum(["deterministic", "openai-compatible"]).default("openai-compatible"),
  AI_MODEL: z.string().default("local-context-v1"),
  AI_REVIEW_MODEL: z.string().default("gpt-5.6-luna"),
  AI_CRITIC_MODEL: z.string().default("gpt-5.6-luna"),
  AI_REVIEW_REASONING_EFFORT: z.enum(["none", "low", "medium", "high", "xhigh", "max"]).default("high"),
  DUAL_REVIEW_MODE: z.enum(["off", "shadow", "enforced"]).default("enforced"),
  AI_REVIEW_MAX_INPUT_CHARS: int(850_000),
  AI_REVIEW_MAX_RECORDS: int(5_000),
  AI_AUDIT_MAX_TIME_MS: int(180_000),
  AI_AUDIT_MAX_TOOL_CALLS: int(40),
  AI_AUDIT_MAX_PAGES: int(250),
  AI_AUDIT_MAX_IMAGE_REGIONS: int(120),
  AI_AUDIT_MAX_DOCUMENTS: int(24),
  AI_AUDIT_MAX_TOKENS: int(250_000),
  AI_AUDIT_MAX_COST_USD: nonNegative(25),
  AI_CRITIC_MAX_DISAGREEMENTS: int(20),
  AI_VISION_MODEL: z.string().default("gpt-4.1-mini"),
  AI_DOCUMENT_MODEL: z.string().default("gpt-4.1-mini"),
  AI_API_KEY: optionalNonEmpty,
  AI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  AI_TIMEOUT_MS: int(45_000),
  AI_MAX_PAGE_CHARS: int(24_000),
  AI_MAX_OUTPUT_TOKENS: int(3_000),
  AI_PAGE_CONCURRENCY: int(3).transform((value) => Math.min(value, 8)),
  AI_VISUAL_MAX_PAGES: int(12),
  AI_VISUAL_MAX_ASSETS_PER_PAGE: int(6),
  AI_VISUAL_MAX_IMAGE_BYTES: int(4_000_000),
  AI_DOCUMENT_MAX_FILES: int(12),
  AI_DOCUMENT_MAX_PAGES: int(20),
  AI_DOCUMENT_MAX_CHARS: int(40_000),
  PUBLIC_API_MAX_RESPONSES: int(50),
  CHECKOUT_EXPLORATION_MODE: z.enum(["read_only", "anonymous_cart"]).default("read_only"),
  EXTERNAL_VERIFICATION_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  EXTERNAL_VERIFICATION_MAX_CLAIMS: int(10),
  AI_INPUT_COST_PER_MILLION: nonNegative(0),
  AI_OUTPUT_COST_PER_MILLION: nonNegative(0),
  AI_VISION_INPUT_COST_PER_MILLION: optionalNonNegative,
  AI_VISION_OUTPUT_COST_PER_MILLION: optionalNonNegative,
  AI_DOCUMENT_INPUT_COST_PER_MILLION: optionalNonNegative,
  AI_DOCUMENT_OUTPUT_COST_PER_MILLION: optionalNonNegative,
  SCREENSHOT_STORAGE: z.string().default("./storage/evidence"),
  CRAWLER_MAX_PAGES: int(250),
  CRAWLER_MAX_DEPTH: int(4),
  CRAWLER_CONCURRENCY: int(3),
  CRAWLER_RESPONSE_LIMIT_BYTES: int(5_000_000),
  CRAWLER_NAVIGATION_TIMEOUT_MS: int(20_000),
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
