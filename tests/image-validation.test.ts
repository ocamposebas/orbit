import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";

vi.mock("node:dns/promises", () => ({ default: { lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) } }));

import { detectImageMime, ImageValidationSession } from "@/sentinel/evidence/image-validation";
import { isolateInvalidImageCandidates } from "@/sentinel/review/luna";
import { safeFetchBinary } from "@/sentinel/security/ssrf";

function bytesFromDataUrl(value: string) {
  return new Uint8Array(Buffer.from(value.split(",")[1], "base64"));
}

describe("merchant image validation", () => {
  let png: Uint8Array;
  let jpeg: Uint8Array;
  let webp: Uint8Array;
  const validator = new ImageValidationSession(1_000_000);

  beforeAll(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const fixtures = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 3;
        canvas.height = 2;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#6846d6";
        context.fillRect(0, 0, canvas.width, canvas.height);
        return {
          png: canvas.toDataURL("image/png"),
          jpeg: canvas.toDataURL("image/jpeg", 0.9),
          webp: canvas.toDataURL("image/webp", 0.9),
        };
      });
      png = bytesFromDataUrl(fixtures.png);
      jpeg = bytesFromDataUrl(fixtures.jpeg);
      webp = bytesFromDataUrl(fixtures.webp);
    } finally {
      await browser.close();
    }
  });

  afterAll(async () => validator.close());

  it("validates actual PNG, JPEG and WebP bytes independently of a declared MIME", async () => {
    for (const [bytes, mime] of [[png, "image/png"], [jpeg, "image/jpeg"], [webp, "image/webp"]] as const) {
      expect(detectImageMime(bytes)).toBe(mime);
      await expect(validator.validate(bytes)).resolves.toMatchObject({ ok: true, detectedMime: mime, outputMime: mime, validationResult: "VALIDATED", width: 3, height: 2 });
    }
  });

  it("rejects corrupt image bytes even when their magic prefix looks like PNG", async () => {
    const corrupt = new Uint8Array([...png.slice(0, 16), 1, 2, 3, 4]);
    expect(detectImageMime(corrupt)).toBe("image/png");
    await expect(validator.validate(corrupt)).resolves.toMatchObject({ ok: false, detectedMime: "image/png", skipReason: "IMAGE_DECODE_FAILED" });
  });

  it("detects HTML masquerading as an image and rejects empty responses", async () => {
    const html = new TextEncoder().encode("<!doctype html><html><body>upstream error</body></html>");
    await expect(validator.validate(html)).resolves.toMatchObject({ ok: false, detectedMime: "text/html", skipReason: "HTML_RESPONSE" });
    await expect(validator.validate(new Uint8Array())).resolves.toMatchObject({ ok: false, detectedMime: null, byteSize: 0, skipReason: "EMPTY_IMAGE" });
  });

  it("rasterizes SVG to validated PNG and safely rejects a corrupt AVIF container", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="red"/></svg>');
    const rasterized = await validator.validate(svg);
    expect(rasterized).toMatchObject({ ok: true, detectedMime: "image/svg+xml", outputMime: "image/png", validationResult: "RASTERIZED", width: 4, height: 3 });
    expect(detectImageMime(rasterized.outputBytes!)).toBe("image/png");

    const corruptAvif = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0, 0x61, 0x76, 0x69, 0x66]);
    expect(detectImageMime(corruptAvif)).toBe("image/avif");
    await expect(validator.validate(corruptAvif)).resolves.toMatchObject({ ok: false, detectedMime: "image/avif", skipReason: "IMAGE_DECODE_FAILED" });
  });

  it("follows a redirect through the existing safe fetch path", async () => {
    const originalFetch = global.fetch;
    const mockedFetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://cdn.merchant.test/final.png" } }))
      .mockResolvedValueOnce(new Response(png as unknown as BodyInit, { status: 200, headers: { "content-type": "text/html" } }));
    global.fetch = mockedFetch;
    try {
      const fetched = await safeFetchBinary("https://merchant.test/image.png", { maxBytes: 1_000_000 });
      expect(fetched.url.toString()).toBe("https://cdn.merchant.test/final.png");
      expect(detectImageMime(fetched.bytes)).toBe("image/png");
      expect(mockedFetch).toHaveBeenCalledTimes(2);
      expect(mockedFetch.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("keeps 39 valid candidates when one image among 40 is invalid", async () => {
    const candidates = Array.from({ length: 40 }, (_, index) => ({ index, bytes: index === 23 ? new Uint8Array([1, 2, 3]) : png }));
    const locallyValid: typeof candidates = [];
    const locallyInvalid: typeof candidates = [];
    for (const candidate of candidates) {
      if ((await validator.validate(candidate.bytes)).ok) locallyValid.push(candidate);
      else locallyInvalid.push(candidate);
    }
    expect(locallyValid).toHaveLength(39);
    expect(locallyInvalid.map((candidate) => candidate.index)).toEqual([23]);

    const isolated = await isolateInvalidImageCandidates(candidates, async (group) => !group.some((candidate) => candidate.index === 23));
    expect(isolated.valid).toHaveLength(39);
    expect(isolated.invalid.map((candidate) => candidate.index)).toEqual([23]);
  });
});
