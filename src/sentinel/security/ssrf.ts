import dns from "node:dns/promises";
import net from "node:net";
import { z } from "zod";

const urlInputSchema = z.string().trim().min(1).max(2048);
const blockedHostnames = new Set(["localhost", "localhost.localdomain", "metadata.google.internal", "metadata.google", "instance-data"]);

export class UnsafeTargetError extends Error {
  constructor(message: string) { super(message); this.name = "UnsafeTargetError"; }
}

export function normalizePublicUrl(input: string): URL {
  const raw = urlInputSchema.parse(input);
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(candidate);
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new UnsafeTargetError("Only HTTP and HTTPS targets are allowed");
  if (url.username || url.password) throw new UnsafeTargetError("Credentials in target URLs are not allowed");
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  url.hash = "";
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  if (blockedHostnames.has(url.hostname) || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local") || url.hostname.endsWith(".internal")) throw new UnsafeTargetError("Local and internal hostnames are blocked");
  return url;
}

function isBlockedIpv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function isBlockedIpv6(ip: string): boolean {
  const value = ip.toLowerCase().split("%")[0];
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("fc") || value.startsWith("fd") || /^fe[89ab]/.test(value)) return true;
  if (value.startsWith("ff")) return true;
  const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? isBlockedIpv4(mapped) : false;
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true;
}

export async function validatePublicUrl(input: string | URL): Promise<URL> {
  const url = normalizePublicUrl(input.toString());
  if (net.isIP(url.hostname) && isPrivateOrReservedIp(url.hostname)) throw new UnsafeTargetError("Private and reserved IP ranges are blocked");
  let addresses: Array<{ address: string; family: number }>;
  try { addresses = await dns.lookup(url.hostname, { all: true, verbatim: true }); }
  catch { throw new UnsafeTargetError("Target hostname could not be resolved"); }
  if (!addresses.length || addresses.some(({ address }) => isPrivateOrReservedIp(address))) throw new UnsafeTargetError("Target resolves to a private or reserved network");
  return url;
}

export interface SafeFetchOptions { timeoutMs?: number; maxBytes?: number; maxRedirects?: number; accept?: string; headers?: Record<string, string>; method?: "GET" | "POST"; body?: string; }

export async function safeFetchBinary(input: string | URL, options: SafeFetchOptions = {}): Promise<{ url: URL; status: number; contentType: string; bytes: Uint8Array; headers: Headers }> {
  let current = await validatePublicUrl(input);
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxBytes = options.maxBytes ?? 2_000_000;
  const maxRedirects = options.maxRedirects ?? 4;
  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = new Headers(options.headers);
      headers.set("user-agent", "ORBIT-Sentinel/1.0 (+compliance-monitoring)");
      headers.set("accept", options.accept ?? "text/html,application/xml,text/plain;q=0.9");
      const response = await fetch(current, { method: options.method ?? "GET", body: options.body, redirect: "manual", signal: controller.signal, headers });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirect === maxRedirects) throw new UnsafeTargetError("Redirect limit exceeded");
        current = await validatePublicUrl(new URL(location, current));
        continue;
      }
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > maxBytes) throw new UnsafeTargetError("Response exceeds the configured size limit");
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) { await reader.cancel(); throw new UnsafeTargetError("Response exceeds the configured size limit"); }
          chunks.push(value);
        }
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return { url: current, status: response.status, contentType: response.headers.get("content-type") ?? "", bytes, headers: response.headers };
    } finally { clearTimeout(timeout); }
  }
  throw new UnsafeTargetError("Unable to fetch target safely");
}

export async function safeFetchText(input: string | URL, options: SafeFetchOptions = {}): Promise<{ url: URL; status: number; contentType: string; text: string; headers: Headers }> {
  const response = await safeFetchBinary(input, options);
  return { ...response, text: new TextDecoder().decode(response.bytes) };
}
