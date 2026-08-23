const defaultContinuation = "/sentinel";
const sentinelPath = /^\/sentinel(?:\/|$)/;
const stripeRefreshPath = /^\/merchants\/c[a-z0-9]{20,31}\/integrations\/stripe\/refresh$/;

export function safeLoginContinuation(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.length > 2_048 || /[\\\u0000-\u001f]/.test(value)) return defaultContinuation;
  try {
    const base = new URL("https://orbit.invalid");
    const parsed = new URL(value, base);
    const decodedPath = decodeURIComponent(parsed.pathname);
    if (parsed.origin !== base.origin || parsed.username || parsed.password || /[\\\u0000-\u001f]/.test(decodedPath)) return defaultContinuation;
    if (!sentinelPath.test(decodedPath) && !stripeRefreshPath.test(decodedPath)) return defaultContinuation;
    const hash = parsed.hash === "#stripe-connect" ? parsed.hash : "";
    return `${parsed.pathname}${parsed.search}${hash}`;
  } catch {
    return defaultContinuation;
  }
}
