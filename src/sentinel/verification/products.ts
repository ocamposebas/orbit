import type { EvidenceManifest } from "@/sentinel/evidence/schema";
import type { NormalizedContent, SentinelPageType } from "@/sentinel/types";
import { isEditorialUrl } from "@/sentinel/classification/classifier";

export interface ProductPageInput {
  url: string;
  canonicalUrl?: string;
  httpStatus?: number;
  pageType: SentinelPageType;
  content: NormalizedContent;
}

export interface VerifiedProductRecord {
  url: string;
  canonicalUrl: string;
  name: string;
  sku?: string;
  prices: string[];
  variants: NormalizedContent["productVariations"];
  categories: string[];
  ctas: string[];
  availability?: string;
  signals: string[];
  confidence: number;
  evidenceRecordIds: string[];
}

function containsProduct(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsProduct);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const type = Array.isArray(record["@type"]) ? record["@type"].join(" ") : String(record["@type"] ?? "");
  return /(?:^|\s)product(?:$|\s)/i.test(type) || Object.values(record).some(containsProduct);
}

function publicCommerceEvidence(page: ProductPageInput, manifest?: EvidenceManifest) {
  return manifest?.records.some((record) => record.artifactKind === "PUBLIC_API" && record.parentUrl === page.url && /(?:product|variant|sku|inventory|price|offer)/i.test(JSON.stringify(record.value ?? ""))) ?? false;
}

export function productIdentitySignals(page: ProductPageInput, manifest?: EvidenceManifest) {
  const content = page.content;
  const structuredProduct = content.structuredData.some(containsProduct);
  const ctas = [...content.buttons, ...content.linkCtas.map((item) => item.text)].filter((text) => /\b(?:add to cart|buy now|purchase|select options?|choose options?)\b/i.test(text));
  const signals = [
    structuredProduct && "PRODUCT_STRUCTURED_DATA",
    Boolean(content.sku) && "SKU",
    ctas.length > 0 && "COMMERCE_CTA",
    content.prices.length > 0 && "PRICE",
    content.productVariations.length > 0 && "VARIANT_CONTROL",
    content.stockText.length > 0 && "INVENTORY",
    Object.entries(content.openGraph).some(([key, value]) => /product/i.test(`${key} ${value}`)) && "PRODUCT_METADATA",
    publicCommerceEvidence(page, manifest) && "PUBLIC_COMMERCE_API",
    ["PRODUCT"].includes(page.pageType) && "PRODUCT_TEMPLATE",
    content.productCategories.length > 0 && "CATEGORY_RELATIONSHIP",
  ].filter((value): value is string => Boolean(value));
  const weights: Record<string, number> = { PRODUCT_STRUCTURED_DATA: 6, SKU: 5, COMMERCE_CTA: 4, PRICE: 2, VARIANT_CONTROL: 3, INVENTORY: 1, PRODUCT_METADATA: 2, PUBLIC_COMMERCE_API: 4, PRODUCT_TEMPLATE: 1, CATEGORY_RELATIONSHIP: 1 };
  return { signals, score: signals.reduce((sum, signal) => sum + weights[signal], 0), ctas };
}

export function verifiedProductRecords(pages: ProductPageInput[], manifest?: EvidenceManifest): VerifiedProductRecord[] {
  const records: VerifiedProductRecord[] = [];
  for (const page of pages) {
    if ((page.httpStatus ?? 200) >= 400 || isEditorialUrl(page.url)) continue;
    const identity = productIdentitySignals(page, manifest);
    const content = page.content;
    const independentlyNamed = Boolean(content.productName?.trim());
    const strongIdentity = identity.signals.includes("PRODUCT_STRUCTURED_DATA")
      || identity.signals.includes("SKU")
      || identity.signals.includes("PUBLIC_COMMERCE_API")
      || (identity.signals.includes("COMMERCE_CTA") && identity.signals.includes("PRICE"))
      || (identity.signals.includes("VARIANT_CONTROL") && identity.signals.includes("PRICE"));
    if (!independentlyNamed || !strongIdentity || identity.score < 6) continue;
    let canonicalUrl = page.url;
    try {
      const canonical = new URL(page.canonicalUrl ?? page.url, page.url);
      if (canonical.hostname === new URL(page.url).hostname && !isEditorialUrl(canonical.href)) canonicalUrl = canonical.href;
    } catch { /* retain observed URL */ }
    const evidenceRecordIds = manifest?.records.filter((record) => record.scope === "MERCHANT_SITE" && (record.sourceUrl === page.url || record.parentUrl === page.url) && ["PRODUCT_NAME", "PRICE", "STRUCTURED_DATA", "STOCK", "LINK_CTA", "INTERACTIVE_STATE", "PRODUCT_CATEGORY", "PUBLIC_JSON"].includes(record.evidenceType)).map((record) => record.id).slice(0, 50) ?? [];
    records.push({
      url: page.url,
      canonicalUrl,
      name: content.productName!.trim(),
      sku: content.sku,
      prices: content.prices,
      variants: content.productVariations,
      categories: content.productCategories,
      ctas: identity.ctas,
      availability: content.stockText.map((item) => item.text).join(" | ") || undefined,
      signals: identity.signals,
      confidence: Number(Math.min(0.99, 0.55 + identity.score * 0.035).toFixed(2)),
      evidenceRecordIds,
    });
  }
  return [...new Map(records.map((record) => [record.canonicalUrl, record])).values()];
}

export function possibleProductCount(pages: ProductPageInput[], manifest?: EvidenceManifest) {
  return pages.filter((page) => !isEditorialUrl(page.url) && productIdentitySignals(page, manifest).score >= 3).length;
}
