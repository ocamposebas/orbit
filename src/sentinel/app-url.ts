const APP_URL_ERROR = "APP_URL must contain one or two comma-separated HTTP(S) origins";

function normalizeOrigin(value: string) {
  const url = new URL(value.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) throw new Error(APP_URL_ERROR);
  return url.origin;
}

export function parseAppUrlConfiguration(value: string) {
  const entries = value.split(",").map((entry) => entry.trim());
  if (entries.length < 1 || entries.length > 2 || entries.some((entry) => !entry)) throw new Error(APP_URL_ERROR);

  let origins: string[];
  try {
    origins = entries.map(normalizeOrigin);
  } catch {
    throw new Error(APP_URL_ERROR);
  }
  if (new Set(origins).size !== origins.length) throw new Error(`${APP_URL_ERROR}; origins must be unique`);

  return {
    canonicalOrigin: origins[0],
    allowedOrigins: origins as readonly string[],
  };
}

export function appOriginIsAllowed(appUrl: string, candidate: string) {
  let origin: string;
  try {
    origin = normalizeOrigin(candidate);
  } catch {
    return false;
  }
  return parseAppUrlConfiguration(appUrl).allowedOrigins.includes(origin);
}

export function appOriginForRequest(appUrl: string, request: Pick<Request, "url" | "headers">) {
  const configuration = parseAppUrlConfiguration(appUrl);
  const candidates = [request.headers.get("origin"), new URL(request.url).origin];
  for (const candidate of candidates) {
    if (candidate && appOriginIsAllowed(appUrl, candidate)) return normalizeOrigin(candidate);
  }
  return configuration.canonicalOrigin;
}
