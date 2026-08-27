export async function sentinelFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(url, { ...init, headers, credentials: "same-origin", cache: "no-store" });
  const data = await response.json();
  if (response.status === 401 && typeof window !== "undefined") window.location.replace("/login?next=/sentinel");
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
}
