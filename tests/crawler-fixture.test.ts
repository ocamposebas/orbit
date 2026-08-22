import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crawlSite } from "@/sentinel/crawler/crawl";

let origin = "";
const server = createServer((request, response) => {
  response.setHeader("content-type", "text/html; charset=utf-8");
  if (request.url === "/product") return response.end(`<!doctype html><html><head><title>Reference Beta 20mg</title><script type="application/ld+json">{"@type":"Product","name":"Reference Beta","sku":"B-20"}</script></head><body><main><h1>Reference Beta 20mg</h1><p>Supports rapid weight loss.</p><p>$62.00</p></main></body></html>`);
  return response.end(`<!doctype html><html><head><title>Fixture Research</title></head><body><main><h1>Research catalog</h1><p>For research use only.</p><a href="/product">Reference Beta</a><a href="/privacy">Privacy policy</a></main></body></html>`);
});

beforeAll(async () => { await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture server did not start"); origin = `http://127.0.0.1:${address.port}`; });
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

describe("real Playwright crawl against local fixture", () => {
  it("renders JavaScript-capable pages, follows internal links and classifies a product", async () => { const pages = await crawlSite(origin, { maxPages: 3, concurrency: 1, unsafeAllowPrivateTestTarget: true }); expect(pages.some((page) => page.url.endsWith("/product") && page.classification?.pageType === "PRODUCT")).toBe(true); expect(pages.find((page) => page.url.endsWith("/product"))?.normalized?.claims).toContain("Supports rapid weight loss."); });
});
