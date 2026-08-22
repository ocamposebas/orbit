import { createHash } from "node:crypto";

const dynamicPatterns = [/\b\d+\s+(seconds?|minutes?)\s+ago\b/gi, /\b(session|cart|cache|nonce)[-_ ]?id[:=]\s*[\w-]+\b/gi, /[?&](utm_[^=]+|gclid|fbclid)=[^&\s]+/gi];

export function normalizeText(value: string): string {
  let output = value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  for (const pattern of dynamicPatterns) output = output.replace(pattern, "");
  return output.replace(/\s+/g, " ").trim();
}

export function normalizeForHash(value: string): string {
  return normalizeText(value).normalize("NFKC");
}

export function stableUnique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.map(normalizeText).filter((value) => value.length > 0 && !seen.has(value.toLowerCase()) && Boolean(seen.add(value.toLowerCase())));
}

export function contentHash(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

export function splitSentences(text: string): string[] {
  return stableUnique(text.split(/(?<=[.!?])\s+|\n+/).map((value) => value.trim()).filter((value) => value.length >= 12 && value.length <= 500));
}
