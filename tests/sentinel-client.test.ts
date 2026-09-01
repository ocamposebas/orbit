import { afterEach, describe, expect, it, vi } from "vitest";
import { sentinelFetch } from "@/components/sentinel/client";

describe("Sentinel API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preserves a structured API error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "The PDF is password-protected", requestId: "pdf-request-1" }, { status: 422 })));
    await expect(sentinelFetch("/api/import", { method: "POST" })).rejects.toThrow("The PDF is password-protected · Reference pdf-request-1");
  });

  it("turns a non-JSON gateway timeout into an actionable upload error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Gateway timeout", { status: 504, headers: { "content-type": "text/html" } })));
    await expect(sentinelFetch("/api/import", { method: "POST" })).rejects.toThrow("The server could not finish processing the document. Please retry the upload");
  });
});
