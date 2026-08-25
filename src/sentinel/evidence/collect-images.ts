import { createHash } from "node:crypto";
import { getServerEnv } from "@/sentinel/config";
import { safeFetchBinary } from "@/sentinel/security/ssrf";
import { evidenceStorage } from "@/sentinel/storage";
import type { NormalizedContent, SentinelPageType } from "@/sentinel/types";
import { persistArtifactEvidence } from "./ledger";

function hash(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function extension(contentType: string) {
  if (/png/i.test(contentType)) return "png";
  if (/webp/i.test(contentType)) return "webp";
  if (/gif/i.test(contentType)) return "gif";
  if (/svg/i.test(contentType)) return "svg";
  return "jpg";
}

export async function collectMerchantImages(scanId: string, pages: Array<{ url: string; pageType: SentinelPageType; content: NormalizedContent }>) {
  const env = getServerEnv();
  const ranked = [...pages].sort((left, right) => Number(right.pageType === "PRODUCT") - Number(left.pageType === "PRODUCT"));
  const references = [...new Map(ranked.flatMap((page) => page.content.images.map((image) => ({ ...image, parentUrl: page.url, pageType: page.pageType }))).filter((image) => /^https?:/i.test(image.src)).map((image) => [image.src, image])).values()].slice(0, env.AI_REVIEW_MAX_IMAGES);
  let retained = 0;
  let failed = 0;
  for (const image of references) {
    try {
      const response = await safeFetchBinary(image.src, { maxBytes: env.AI_VISUAL_MAX_IMAGE_BYTES, timeoutMs: env.AI_TIMEOUT_MS, accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml" });
      if (response.status >= 400 || !response.contentType.toLowerCase().startsWith("image/")) throw new Error("Image URL did not return a supported public image");
      const sha256 = hash(response.bytes);
      const storageKey = `${scanId}/images/${sha256}.${extension(response.contentType)}`;
      await evidenceStorage().put(storageKey, response.bytes);
      await persistArtifactEvidence({ scanId, kind: "IMAGE", url: response.url.toString(), parentUrl: image.parentUrl, mimeType: response.contentType, httpStatus: response.status, storageKey, sha256, metadata: { pageType: image.pageType, filename: image.filename, alt: image.alt, title: image.title }, records: [{ evidenceType: "IMAGE_FILE", exactText: [image.alt, image.title].filter(Boolean).join(" | ") || undefined, value: { filename: image.filename, alt: image.alt, title: image.title } }] });
      retained++;
    } catch {
      failed++;
    }
  }
  return { discovered: references.length, retained, failed };
}
