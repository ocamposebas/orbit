export async function sentinelFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers }, credentials: "same-origin", cache: "no-store" });
  const data = await response.json();
  if (response.status === 401 && typeof window !== "undefined") window.location.replace("/login?next=/sentinel");
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
}
