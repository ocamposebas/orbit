import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "orbit-sentinel" },
  redact: ["req.headers.authorization", "AI_API_KEY", "password", "encryptedConfig"],
});

export function childLogger(context: Record<string, string | number | undefined>) {
  return logger.child(context);
}
