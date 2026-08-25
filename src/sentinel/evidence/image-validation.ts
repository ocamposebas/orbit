import { chromium, type Browser, type Page } from "playwright";

export const OPENAI_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
export type OpenAIImageMimeType = (typeof OPENAI_IMAGE_MIME_TYPES)[number];

export type ImageValidationResult = {
  ok: boolean;
  detectedMime: string | null;
  byteSize: number;
  outputMime?: OpenAIImageMimeType;
  outputBytes?: Uint8Array;
  width?: number;
  height?: number;
  validationResult: "VALIDATED" | "RASTERIZED" | "REJECTED";
  skipReason?: string;
};

const htmlPrefix = /^(?:\s|<!--[^]*?-->)*(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i;
const svgPrefix = /^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i;

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}

export function detectImageMime(bytes: Uint8Array): string | null {
  if (!bytes.byteLength) return null;
  const prefix = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 1_024)).replace(/^\uFEFF/, "");
  if (htmlPrefix.test(prefix)) return "text/html";
  if (svgPrefix.test(prefix)) return "image/svg+xml";
  if (bytes.byteLength >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.byteLength >= 6 && new Set(["GIF87a", "GIF89a"]).has(ascii(bytes, 0, 6))) return "image/gif";
  if (bytes.byteLength >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (bytes.byteLength >= 16 && ascii(bytes, 4, 8) === "ftyp") {
    const brands = ascii(bytes, 8, Math.min(bytes.byteLength, 40));
    if (/avif|avis/.test(brands)) return "image/avif";
  }
  if (bytes.byteLength >= 2 && ascii(bytes, 0, 2) === "BM") return "image/bmp";
  if (bytes.byteLength >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return "image/x-icon";
  return null;
}

function directlySupported(mimeType: string): mimeType is OpenAIImageMimeType {
  return (OPENAI_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

function rasterizable(mimeType: string) {
  return new Set(["image/svg+xml", "image/avif", "image/bmp", "image/x-icon"]).has(mimeType);
}

export class ImageValidationSession {
  private browser?: Browser;
  private page?: Page;

  constructor(private readonly maximumBytes: number, private readonly maximumPixels = 40_000_000) {}

  private async decoderPage() {
    if (this.page) return this.page;
    this.browser = await chromium.launch({ headless: true });
    const context = await this.browser.newContext({ serviceWorkers: "block", javaScriptEnabled: true });
    await context.route("**/*", async (route) => /^(?:data|blob|about):/.test(route.request().url()) ? route.continue() : route.abort("blockedbyclient"));
    this.page = await context.newPage();
    return this.page;
  }

  async validate(bytes: Uint8Array): Promise<ImageValidationResult> {
    const byteSize = bytes.byteLength;
    const detectedMime = detectImageMime(bytes);
    if (!byteSize) return { ok: false, detectedMime, byteSize, validationResult: "REJECTED", skipReason: "EMPTY_IMAGE" };
    if (byteSize > this.maximumBytes) return { ok: false, detectedMime, byteSize, validationResult: "REJECTED", skipReason: "IMAGE_TOO_LARGE" };
    if (detectedMime === "text/html") return { ok: false, detectedMime, byteSize, validationResult: "REJECTED", skipReason: "HTML_RESPONSE" };
    if (!detectedMime || (!directlySupported(detectedMime) && !rasterizable(detectedMime))) return { ok: false, detectedMime, byteSize, validationResult: "REJECTED", skipReason: "UNSUPPORTED_OR_UNKNOWN_IMAGE" };

    try {
      const page = await this.decoderPage();
      const decoded = await page.evaluate(async ({ base64, mimeType, convertToPng, maximumPixels }) => {
        const image = new Image();
        image.src = `data:${mimeType};base64,${base64}`;
        await image.decode();
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        if (!width || !height) throw new Error("Decoded image has no dimensions");
        if (width * height > maximumPixels) throw new Error("Decoded image exceeds pixel limit");
        if (!convertToPng) return { width, height };
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas context unavailable");
        context.drawImage(image, 0, 0);
        return { width, height, pngBase64: canvas.toDataURL("image/png").split(",")[1] };
      }, { base64: Buffer.from(bytes).toString("base64"), mimeType: detectedMime, convertToPng: rasterizable(detectedMime), maximumPixels: this.maximumPixels });
      if (decoded.pngBase64) {
        const outputBytes = new Uint8Array(Buffer.from(decoded.pngBase64, "base64"));
        if (outputBytes.byteLength > this.maximumBytes) return { ok: false, detectedMime, byteSize, width: decoded.width, height: decoded.height, validationResult: "REJECTED", skipReason: "RASTERIZED_IMAGE_TOO_LARGE" };
        return { ok: true, detectedMime, byteSize, outputMime: "image/png", outputBytes, width: decoded.width, height: decoded.height, validationResult: "RASTERIZED" };
      }
      return { ok: true, detectedMime, byteSize, outputMime: detectedMime as OpenAIImageMimeType, outputBytes: bytes, width: decoded.width, height: decoded.height, validationResult: "VALIDATED" };
    } catch {
      return { ok: false, detectedMime, byteSize, validationResult: "REJECTED", skipReason: "IMAGE_DECODE_FAILED" };
    }
  }

  async close() {
    await this.page?.context().close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.page = undefined;
    this.browser = undefined;
  }
}
