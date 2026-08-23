import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "orbit-sentinel" },
  redact: ["req.headers.authorization", "AI_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_CONNECT_WEBHOOK_SECRET", "STRIPE_PAYMENTS_WEBHOOK_SECRET", "clientSecret", "password", "encryptedConfig", "secret", "signature"],
});

export function childLogger(context: Record<string, string | number | undefined>) {
  return logger.child(context);
}
