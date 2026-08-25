import pino from "pino";

const MAX_ERROR_MESSAGE_LENGTH = 4_000;
const MAX_ERROR_STACK_LENGTH = 12_000;

function truncate(value: string, maximumLength: number) {
  return value.length > maximumLength
    ? `${value.slice(0, maximumLength)}...[truncated]`
    : value;
}

export function sanitizeLogText(value: string, maximumLength = MAX_ERROR_MESSAGE_LENGTH) {
  const configuredApiKey = process.env.AI_API_KEY;
  const withoutConfiguredApiKey = configuredApiKey ? value.split(configuredApiKey).join("[REDACTED]") : value;
  return truncate(withoutConfiguredApiKey, maximumLength)
    .replace(/\bBearer\s+[^\s"'`,;]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(
      /\b(authorization|cookies?|tokens?|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?keys?|client[_-]?secret|secrets?|passwords?)\b\s*[:=]\s*([^\s,;]+)/gi,
      "$1=[REDACTED]",
    );
}

export function serializeErrorForLog(value: unknown) {
  if (value instanceof Error) {
    return {
      name: sanitizeLogText(value.name || "Error"),
      message: sanitizeLogText(value.message),
      stack: value.stack ? sanitizeLogText(value.stack, MAX_ERROR_STACK_LENGTH) : undefined,
    };
  }

  return {
    name: "NonErrorThrown",
    message: sanitizeLogText(typeof value === "string" ? value : "Unknown error"),
    stack: undefined,
  };
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "orbit-sentinel" },
  serializers: {
    error: serializeErrorForLog,
    err: serializeErrorForLog,
  },
  redact: ["req.headers.authorization", "AI_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_CONNECT_WEBHOOK_SECRET", "STRIPE_PAYMENTS_WEBHOOK_SECRET", "clientSecret", "password", "encryptedConfig", "secret", "signature"],
});

export function childLogger(context: Record<string, string | number | undefined>) {
  return logger.child(context);
}
