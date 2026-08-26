import { createHash } from "node:crypto";
import { getServerEnv } from "@/sentinel/config";
import { contentHash } from "@/sentinel/extraction/normalize";
import { ImageValidationSession, type ImageValidationResult } from "@/sentinel/evidence/image-validation";
import { logger } from "@/sentinel/logger";
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
  return "jpg";
}

function unavailableHash(image: { src: string; parentUrl: string; alt?: string; title?: string }) {
  return contentHash({ status: "VISUAL_UNAVAILABLE", url: image.src, parentUrl: image.parentUrl, alt: image.alt, title: image.title });
}

function validationLog(artifactId: string, result: ImageValidationResult) {
  return {
    imageEvidenceId: artifactId,
    detectedMime: result.detectedMime,
    byteSize: result.byteSize,
    validationResult: result.validationResult,
    skipReason: result.skipReason ?? null,
  };
}

export async function collectMerchantImages(scanId: string, pages: Array<{ url: string; pageType: SentinelPageType; content: NormalizedContent }>) {
  const env = getServerEnv();
  const ranked = [...pages].sort((left, right) => Number(right.pageType === "PRODUCT") - Number(left.pageType === "PRODUCT"));
  const discoveredReferences = [...new Map(ranked.flatMap((page) => page.content.images.map((image) => ({ ...image, parentUrl: page.url, pageType: page.pageType, composition: { pageUrl: page.url, visibleText: page.content.visibleText?.slice(0, 8_000) ?? "", surroundingDom: page.content.domEvidence?.slice(0, 80) ?? [], linksAndCtas: page.content.linkCtas?.slice(0, 40) ?? [], categories: page.content.productCategories ?? [], productName: page.content.productName ?? null, prominence: ["PRODUCT", "CATEGORY", "COLLECTION", "HOME", "LANDING"].includes(page.pageType) ? "COMMERCIAL" : ["ARTICLE", "BLOG"].includes(page.pageType) ? "EDITORIAL" : "SUPPORTING" } }))).filter((image) => /^https?:/i.test(image.src)).map((image) => [image.src, image])).values()];
  const references = discoveredReferences.slice(0, env.AI_AUDIT_MAX_IMAGE_REGIONS ?? Number.POSITIVE_INFINITY);
  let retained = 0;
  let failed = 0;
  let rasterized = 0;
  const validator = new ImageValidationSession(env.AI_VISUAL_MAX_IMAGE_BYTES);
  try {
    for (const image of references) {
      let response: Awaited<ReturnType<typeof safeFetchBinary>> | undefined;
      let inspectedValidation: ImageValidationResult | undefined;
      try {
        response = await safeFetchBinary(image.src, { maxBytes: env.AI_VISUAL_MAX_IMAGE_BYTES, timeoutMs: env.AI_TIMEOUT_MS, accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml" });
        const originalHash = hash(response.bytes);
        const inspected = await validator.validate(response.bytes);
        const validation = response.status >= 400
          ? { ...inspected, ok: false, outputMime: undefined, outputBytes: undefined, validationResult: "REJECTED", skipReason: inspected.detectedMime === "text/html" ? "HTML_ERROR_RESPONSE" : "HTTP_ERROR" } as ImageValidationResult
          : inspected;
        inspectedValidation = validation;
        if (!validation.ok || !validation.outputBytes || !validation.outputMime) {
          const artifact = await persistArtifactEvidence({
            scanId,
            kind: "IMAGE",
            url: response.url.toString(),
            parentUrl: image.parentUrl,
            mimeType: validation.detectedMime ?? undefined,
            httpStatus: response.status,
            sha256: originalHash,
            metadata: { pageType: image.pageType, filename: image.filename, alt: image.alt, title: image.title, requestedUrl: image.src, declaredContentType: response.contentType, detectedMime: validation.detectedMime, byteSize: validation.byteSize, validationResult: validation.validationResult, visualAvailability: "VISUAL_UNAVAILABLE", skipReason: validation.skipReason },
            records: [{ evidenceType: "VISUAL_UNAVAILABLE", exactText: [image.alt, image.title].filter(Boolean).join(" | ") || undefined, value: { filename: image.filename, alt: image.alt, title: image.title, detectedMime: validation.detectedMime, byteSize: validation.byteSize, reason: validation.skipReason } }],
          });
          logger.warn(validationLog(artifact.id, validation), "Merchant image excluded from Luna visual payload");
          failed++;
          continue;
        }
        const storedHash = hash(validation.outputBytes);
        const storageKey = `${scanId}/images/${storedHash}.${extension(validation.outputMime)}`;
        await evidenceStorage().put(storageKey, validation.outputBytes);
        const artifact = await persistArtifactEvidence({ scanId, kind: "IMAGE", url: response.url.toString(), parentUrl: image.parentUrl, mimeType: validation.outputMime, httpStatus: response.status, storageKey, sha256: originalHash, metadata: { pageType: image.pageType, filename: image.filename, alt: image.alt, title: image.title, requestedUrl: image.src, declaredContentType: response.contentType, detectedMime: validation.detectedMime, byteSize: validation.byteSize, width: validation.width, height: validation.height, validationResult: validation.validationResult, originalHash, storedHash, visualAvailability: "AVAILABLE", composition: image.composition }, records: [{ evidenceType: "IMAGE_FILE", exactText: [image.alt, image.title].filter(Boolean).join(" | ") || undefined, value: { filename: image.filename, alt: image.alt, title: image.title, detectedMime: validation.detectedMime, validationResult: validation.validationResult, composition: image.composition } }] });
        logger.info(validationLog(artifact.id, validation), "Merchant image validated for Luna visual payload");
        retained++;
        rasterized += Number(validation.validationResult === "RASTERIZED");
      } catch (error) {
        const skipReason = error instanceof Error && /size limit/i.test(error.message) ? "IMAGE_TOO_LARGE" : "FETCH_OR_STORAGE_FAILED";
        const validation: ImageValidationResult = { ...inspectedValidation, ok: false, detectedMime: inspectedValidation?.detectedMime ?? null, byteSize: inspectedValidation?.byteSize ?? response?.bytes.byteLength ?? 0, outputMime: undefined, outputBytes: undefined, validationResult: "REJECTED", skipReason };
        const artifact = await persistArtifactEvidence({ scanId, kind: "IMAGE", url: response?.url.toString() ?? image.src, parentUrl: image.parentUrl, mimeType: validation.detectedMime ?? undefined, httpStatus: response?.status, sha256: response ? hash(response.bytes) : unavailableHash(image), metadata: { pageType: image.pageType, filename: image.filename, alt: image.alt, title: image.title, requestedUrl: image.src, declaredContentType: response?.contentType, detectedMime: validation.detectedMime, byteSize: validation.byteSize, validationResult: validation.validationResult, visualAvailability: "VISUAL_UNAVAILABLE", skipReason }, records: [{ evidenceType: "VISUAL_UNAVAILABLE", exactText: [image.alt, image.title].filter(Boolean).join(" | ") || undefined, value: { filename: image.filename, alt: image.alt, title: image.title, detectedMime: validation.detectedMime, byteSize: validation.byteSize, reason: skipReason } }] }).catch(() => undefined);
        logger.warn({ ...validationLog(artifact?.id ?? contentHash(image.src), validation) }, "Merchant image could not be retained for Luna visual payload");
        failed++;
      }
    }
  } finally {
    await validator.close();
  }
  const result = { discovered: discoveredReferences.length, retained, failed, rasterized, coveragePercent: discoveredReferences.length ? Math.round(retained / discoveredReferences.length * 100) : 100 };
  return references.length < discoveredReferences.length ? { ...result, inspected: references.length, capped: true } : result;
}
