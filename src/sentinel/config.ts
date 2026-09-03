import { z } from "zod";
import { parseAppUrlConfiguration } from "./app-url";

const int = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const nonNegativeInt = (fallback: number) => z.coerce.number().int().min(0).default(fallback);
const nonNegative = (fallback: number) => z.coerce.number().min(0).default(fallback);
const optionalNonEmpty = z.preprocess((value) => typeof value === "string" && value.trim() === "" ? undefined : value, z.string().trim().min(1).optional());
const optionalUrl = z.preprocess((value) => typeof value === "string" && value.trim() === "" ? undefined : value, z.string().url().optional());
const appUrl = z.string().trim().min(1).default("http://localhost:3000").superRefine((value, context) => {
  try {
    parseAppUrlConfiguration(value);
  } catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "APP_URL is invalid" });
  }
});

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().default("postgresql://orbit:orbit@localhost:5432/orbit?schema=public"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  APP_URL: appUrl,
  AI_SCANNER_MODEL: z.string().default("gpt-5.6-luna"),
  AI_CRITIC_MODEL: optionalNonEmpty,
  AI_SCANNER_REASONING_EFFORT: z.enum(["none", "low", "medium", "high", "xhigh", "max"]).default("high"),
  OPENAI_API_KEY: optionalNonEmpty,
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  AI_SCANNER_REQUEST_TIMEOUT_MS: int(60_000),
  AI_SCANNER_OPENAI_MAX_RETRIES: nonNegativeInt(5),
  AI_SCANNER_OPENAI_RETRY_BASE_MS: int(5_000),
  AI_SCANNER_OPENAI_RETRY_MAX_MS: int(120_000),
  AI_SCANNER_OPENAI_RETRY_TOTAL_MS: int(900_000),
  AI_SCANNER_OPENAI_MAX_RESUMES: nonNegativeInt(12),
  AI_SCANNER_MAX_RUNTIME_MS: int(3_600_000),
  AI_SCANNER_MAX_TOOL_CALLS: int(400),
  AI_SCANNER_MAX_TOKENS: int(20_000_000),
  AI_SCANNER_MAX_COST_USD: nonNegative(50),
  AI_SCANNER_MAX_OUTPUT_TOKENS: int(32_000),
  AI_SCANNER_FINALIZATION_MAX_OUTPUT_TOKENS: int(64_000),
  AI_SCANNER_FINALIZATION_TOKEN_RESERVE: int(400_000),
  AI_SCANNER_CONTEXT_COMPACT_THRESHOLD: int(200_000),
  AI_SCANNER_MAX_EVIDENCE_BYTES: int(5_000_000),
  AI_SCANNER_INPUT_COST_PER_MILLION: nonNegative(0.2),
  AI_SCANNER_OUTPUT_COST_PER_MILLION: nonNegative(1.2),
  AI_SCANNER_BROWSER_HEADLESS: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  SCREENSHOT_STORAGE: z.string().default("./storage/evidence"),
  INTERNAL_JOB_SECRET: z.string().default("development-only"),
  ORBIT_SECRET_ENCRYPTION_KEY: optionalNonEmpty,
  ORBIT_PAYMENTS_PUBLIC_ORIGIN: optionalUrl,
  ORBIT_DEMO_MODE: z.enum(["true", "false"]).default(process.env.NODE_ENV === "production" ? "false" : "true").transform((value) => value === "true"),
  SESSION_TTL_DAYS: int(14),
  SEED_ADMIN_EMAIL: z.string().email().default("admin@orbit.local"),
  SEED_ADMIN_PASSWORD: z.string().min(12).optional(),
  STRIPE_SECRET_KEY: optionalNonEmpty,
  STRIPE_PUBLISHABLE_KEY: optionalNonEmpty,
  STRIPE_PAYMENT_METHOD_CONFIGURATION_ID: optionalNonEmpty,
  STRIPE_MODE: z.enum(["test", "live"]).default("test"),
  STRIPE_CONNECT_ACCOUNT_API: z.enum(["v1", "v2"]).default("v2"),
  STRIPE_CONNECT_WEBHOOK_SECRET: optionalNonEmpty,
  STRIPE_PAYMENTS_WEBHOOK_SECRET: optionalNonEmpty,
  STRIPE_API_VERSION: optionalNonEmpty,
  STATEMENTS_ENABLED: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  STATEMENT_TIMEZONE: z.string().default("America/Chicago").refine((value) => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "Invalid IANA timezone"),
  STATEMENT_GENERATION_DAY: z.coerce.number().int().min(1).max(28).default(1),
  STATEMENT_GENERATION_HOUR: z.coerce.number().int().min(0).max(23).default(8),
  SMTP_HOST: optionalNonEmpty,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURITY: z.enum(["starttls", "tls"]).default("starttls"),
  SMTP_USERNAME: optionalNonEmpty,
  SMTP_PASSWORD: optionalNonEmpty,
  SMTP_FROM_EMAIL: z.preprocess((value) => typeof value === "string" && value.trim() === "" ? undefined : value, z.string().email().optional()),
  SMTP_FROM_NAME: z.string().trim().min(1).default("ORBIT"),
  SMTP_REPLY_TO: z.preprocess((value) => typeof value === "string" && value.trim() === "" ? undefined : value, z.string().email().optional()),
  ECWID_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  ECWID_STORE_ID: optionalNonEmpty,
  ECWID_CLIENT_ID: optionalNonEmpty,
  ECWID_CLIENT_SECRET: optionalNonEmpty,
  ECWID_SECRET_TOKEN: optionalNonEmpty,
  ECWID_ORBIT_MERCHANT_ID: optionalNonEmpty,
  ECWID_STRIPE_PAYMENT_METHOD_CONFIGURATION_ID: optionalNonEmpty,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cached ??= serverEnvSchema.parse(process.env);
  return cached;
}

export function validateStatementEmailConfiguration(env = getServerEnv()) {
  const configured = [env.SMTP_HOST, env.SMTP_USERNAME, env.SMTP_PASSWORD, env.SMTP_FROM_EMAIL].filter(Boolean).length;
  if (configured === 0) return { configured: false as const };
  if (configured !== 4) throw new Error("SMTP configuration is incomplete; host, username, password and from address are required together");
  return { configured: true as const };
}
