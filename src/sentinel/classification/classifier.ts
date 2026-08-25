import type { ClassifiedPage, NormalizedContent, SentinelPageType } from "@/sentinel/types";
import { detectPolicySignals } from "./policy-signals";

type ScoreMap = Partial<Record<SentinelPageType, { score: number; reasons: string[] }>>;

export function looksLikeProductUrl(url: string) {
  const path = new URL(url).pathname;
  return !isEditorialUrl(url) && /\/(?:products?|p)\//i.test(path);
}

export function isEditorialUrl(url: string) {
  return /\/(?:blogs?|articles?|news|insights)(?:\/|$)/i.test(new URL(url).pathname);
}

export function verifiedCanonicalProductUrl(pageUrl: string, observedCanonical?: string | null) {
  if (!observedCanonical) return pageUrl;
  try {
    const page = new URL(pageUrl);
    const canonical = new URL(observedCanonical, page);
    if (!/^https?:$/.test(canonical.protocol) || canonical.hostname !== page.hostname || isEditorialUrl(canonical.href)) return pageUrl;
    return canonical.href;
  } catch {
    return pageUrl;
  }
}

function containsProductStructuredData(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsProductStructuredData);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const type = record["@type"];
  if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) return true;
  return Object.values(record).some(containsProductStructuredData);
}

export function hasProductEvidence(content: NormalizedContent, url?: string) {
  if (url && isEditorialUrl(url)) return false;
  const schemas = JSON.stringify(content.structuredData).toLowerCase();
  const structuredProduct = content.structuredData.some(containsProductStructuredData);
  const commerceAction = content.buttons.some((button) => /\b(?:add to cart|buy now|select options?|choose options?)\b/i.test(button));
  const productMetadata = Boolean(content.sku)
    || content.productVariations.length > 0
    || /(?:^|["{,])(?:product|sku|mpn|gtin|inventory|availability)(?:["}:,]|$)/i.test(schemas)
    || Object.entries(content.openGraph).some(([key, value]) => /product/i.test(`${key} ${value}`));
  const productRoute = url ? looksLikeProductUrl(url) : false;
  const namedCommerceRecord = Boolean(content.productName) && content.prices.length > 0 && (commerceAction || productMetadata || productRoute);
  const routedCommerceRecord = productRoute && Boolean(content.productName) && (content.prices.length > 0 || commerceAction || productMetadata || content.stockText.length > 0);
  return structuredProduct || Boolean(content.sku) || commerceAction || namedCommerceRecord || routedCommerceRecord;
}

function add(scores: ScoreMap, type: SentinelPageType, score: number, reason: string) {
  const current = scores[type] ?? { score: 0, reasons: [] };
  current.score += score;
  current.reasons.push(reason);
  scores[type] = current;
}

export function classifyPage(url: string, content: NormalizedContent): ClassifiedPage {
  const path = new URL(url).pathname.toLowerCase().replace(/\/$/, "") || "/";
  const text = `${content.title} ${content.headings.join(" ")} ${content.visibleText.slice(0, 3000)}`.toLowerCase();
  const scores: ScoreMap = {};

  if (path === "/") add(scores, "HOME", 12, "root URL");
  if (/\/(?:checkout|order)(?:\/|[-_])(?:thank[-_]?you|confirmation|confirmed|complete|completed|receipt|success)(?:\/|$)/i.test(path)) {
    return { pageType: "OTHER", confidence: 0.99, reasons: ["post-purchase confirmation URL is not a pre-payment checkout step"] };
  }
  if (isEditorialUrl(url)) {
    return { pageType: /\/(?:blogs?)(?:\/|$)/i.test(path) ? "BLOG" : "ARTICLE", confidence: 0.99, reasons: ["editorial URL pattern"] };
  }
  if (looksLikeProductUrl(url) && content.controls.loginWall && !hasProductEvidence(content, url)) {
    return { pageType: "ACCOUNT", confidence: 0.98, reasons: ["product-shaped URL returned an authentication wall without observable product evidence"] };
  }
  const pathRules: Array<[RegExp, SentinelPageType, string]> = [
    [/\/(products?|p)\//, "PRODUCT", "product URL pattern"],
    [/\/(collections?|categories?)\//, "COLLECTION", "collection URL pattern"],
    [/\/(privacy)(?:[-_/]|$)/, "PRIVACY", "privacy URL pattern"],
    [/\/(terms|terms-of-service)(?:[-_/]|$)/, "TERMS", "terms URL pattern"],
    [/\/(refund|returns?|cancellation)(?:[-_/]|$)/, "REFUND", "refund URL pattern"],
    [/\/(shipping|delivery)(?:[-_/]|$)/, "SHIPPING", "shipping URL pattern"],
    [/\/(contact|support)(?:[-_/]|$)/, "CONTACT", "contact URL pattern"],
    [/\/(faq|help)(?:[-_/]|$)/, "FAQ", "FAQ URL pattern"],
    [/\/(cart|basket)(?:[-_/]|$)/, "CART", "cart URL pattern"],
    [/\/(checkout)(?:[-_/]|$)/, "CHECKOUT", "checkout URL pattern"],
    [/\/(account|login|sign-in)(?:[-_/]|$)/, "ACCOUNT", "account URL pattern"],
    [/\/(blog)(?:[-_/]|$)/, "BLOG", "blog URL pattern"],
    [/\/(articles?|news)\//, "ARTICLE", "article URL pattern"],
    [/\/(coa|certificate-of-analysis)(?:[-_/]|$)/, "COA", "certificate URL pattern"],
    [/\/(polic(?:y|ies)|research-use|age-policy|promotion-terms)(?:[-_/]|$)/, "POLICY", "general policy URL pattern"],
  ];
  for (const [pattern, type, reason] of pathRules) if (pattern.test(path) && (type !== "PRODUCT" || hasProductEvidence(content, url))) add(scores, type, 8, reason);

  for (const signal of detectPolicySignals(url, content)) {
    const type = signal === "RESEARCH_USE" || signal === "AGE" || signal === "PROMOTION" ? "POLICY" : signal;
    add(scores, type, 9, `${signal.toLowerCase().replaceAll("_", "-")} policy signal`);
  }

  if (content.structuredData.some(containsProductStructuredData)) add(scores, "PRODUCT", 10, "Product structured data");
  if (hasProductEvidence(content, url) && content.prices.length && content.productName) add(scores, "PRODUCT", 4, "verified product identity and commerce signals");
  if (/privacy policy|personal information|data controller/.test(text)) add(scores, "PRIVACY", 6, "privacy-policy language");
  if (/terms of (?:use|service)|limitation of liability|governing law/.test(text)) add(scores, "TERMS", 6, "terms language");
  if (/refund policy|return window|eligible for (?:a )?refund|cancellation/.test(text)) add(scores, "REFUND", 6, "refund language");
  if (/shipping policy|delivery time|shipping rates/.test(text)) add(scores, "SHIPPING", 6, "shipping language");
  if (/contact us|get in touch|customer support/.test(text)) add(scores, "CONTACT", 4, "contact language");
  if (content.forms.some((form) => form.fields.some((field) => field.type === "password"))) add(scores, "ACCOUNT", 8, "password form");
  if (content.forms.some((form) => /contact|support/.test(form.action))) add(scores, "CONTACT", 5, "contact form");

  const ordered = Object.entries(scores).sort(([, a], [, b]) => b.score - a.score) as Array<[SentinelPageType, { score: number; reasons: string[] }]>;
  if (!ordered.length) return { pageType: "OTHER", confidence: 0.35, reasons: ["no strong page-type signal"] };
  const [pageType, winner] = ordered[0];
  if (pageType === "PRODUCT" && !hasProductEvidence(content, url)) return { pageType: "OTHER", confidence: 0.86, reasons: ["product-shaped page lacked observable product or commerce evidence"] };
  const runnerUp = ordered[1]?.[1].score ?? 0;
  const confidence = Math.min(0.99, 0.52 + winner.score * 0.025 + Math.max(0, winner.score - runnerUp) * 0.015);
  return { pageType, confidence: Number(confidence.toFixed(2)), reasons: winner.reasons };
}
