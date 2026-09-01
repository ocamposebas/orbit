export async function sentinelFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(url, { ...init, headers, credentials: "same-origin", cache: "no-store" });
  const contentType = response.headers.get("content-type") ?? "";
  const responseText = await response.text();
  let data: unknown;
  if (contentType.includes("application/json") && responseText) {
    try { data = JSON.parse(responseText); }
    catch { data = undefined; }
  }
  if (response.status === 401 && typeof window !== "undefined") window.location.replace("/login?next=/sentinel");
  if (!response.ok) {
    const apiMessage = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string" ? data.error : undefined;
    const requestId = typeof data === "object" && data !== null && "requestId" in data && typeof data.requestId === "string" ? data.requestId : undefined;
    const fallback = response.status === 413
      ? "The document is too large to upload"
      : [502, 503, 504].includes(response.status)
        ? "The server could not finish processing the document. Please retry the upload"
        : `Request failed (HTTP ${response.status})`;
    const message = apiMessage ?? fallback;
    throw new Error(requestId ? `${message} · Reference ${requestId}` : message);
  }
  if (data === undefined) throw new Error("The server returned an invalid response");
  return data as T;
}
