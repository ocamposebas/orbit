import { beforeAll, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";

const mocks = vi.hoisted(() => ({
  safeFetchBinary: vi.fn(),
  put: vi.fn(async (key: string) => key),
  persistArtifactEvidence: vi.fn(async (input: { records: Array<{ evidenceType: string }>; [key: string]: unknown }) => ({ id: `image-artifact-${input.records[0].evidenceType}-${Math.random()}` })),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/sentinel/config", () => ({ getServerEnv: () => ({ AI_REVIEW_MAX_IMAGES: 40, AI_VISUAL_MAX_IMAGE_BYTES: 1_000_000, AI_TIMEOUT_MS: 10_000 }) }));
vi.mock("@/sentinel/security/ssrf", () => ({ safeFetchBinary: mocks.safeFetchBinary }));
vi.mock("@/sentinel/storage", () => ({ evidenceStorage: () => ({ put: mocks.put }) }));
vi.mock("@/sentinel/evidence/ledger", () => ({ persistArtifactEvidence: mocks.persistArtifactEvidence }));
vi.mock("@/sentinel/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn } }));

import { collectMerchantImages } from "@/sentinel/evidence/collect-images";

describe("merchant image collection validation", () => {
  let validPng: Uint8Array;

  beforeAll(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const dataUrl = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 2;
        canvas.height = 2;
        canvas.getContext("2d")!.fillRect(0, 0, 2, 2);
        return canvas.toDataURL("image/png");
      });
      validPng = new Uint8Array(Buffer.from(dataUrl.split(",")[1], "base64"));
    } finally {
      await browser.close();
    }
  });

  it("retains 39 valid images and records one HTML response as VISUAL_UNAVAILABLE", async () => {
    const html = new TextEncoder().encode("<!doctype html><html><body>origin error</body></html>");
    mocks.safeFetchBinary.mockImplementation(async (input: string) => {
      const invalid = input.endsWith("/23.png");
      return { url: new URL(input), status: 200, contentType: "image/png", bytes: invalid ? html : validPng, headers: new Headers({ "content-type": "image/png" }) };
    });
    const images = Array.from({ length: 40 }, (_, index) => ({ src: `https://merchant.test/${index}.png`, alt: `Product ${index}`, title: "", filename: `${index}.png` }));
    const pages = [{ url: "https://merchant.test/products", pageType: "PRODUCT" as const, content: { images } }] as unknown as Parameters<typeof collectMerchantImages>[1];

    const result = await collectMerchantImages("scan-images", pages);

    expect(result).toEqual({ discovered: 40, retained: 39, failed: 1, rasterized: 0, coveragePercent: 98 });
    expect(mocks.put).toHaveBeenCalledTimes(39);
    expect(mocks.persistArtifactEvidence).toHaveBeenCalledTimes(40);
    const unavailable = mocks.persistArtifactEvidence.mock.calls.map(([input]) => input).find((input) => input.records[0].evidenceType === "VISUAL_UNAVAILABLE");
    expect(unavailable).toMatchObject({
      url: "https://merchant.test/23.png",
      mimeType: "text/html",
      metadata: { alt: "Product 23", declaredContentType: "image/png", detectedMime: "text/html", visualAvailability: "VISUAL_UNAVAILABLE", skipReason: "HTML_RESPONSE" },
      records: [{ evidenceType: "VISUAL_UNAVAILABLE", value: { alt: "Product 23", detectedMime: "text/html", reason: "HTML_RESPONSE" } }],
    });
    expect(mocks.warn).toHaveBeenCalledWith(expect.objectContaining({ detectedMime: "text/html", validationResult: "REJECTED", skipReason: "HTML_RESPONSE" }), expect.any(String));
  });
});
