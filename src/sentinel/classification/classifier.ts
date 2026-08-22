import type { ClassifiedPage, NormalizedContent, SentinelPageType } from "@/sentinel/types";
import { detectPolicySignals } from "./policy-signals";

type ScoreMap = Partial<Record<SentinelPageType, { score: number; reasons: string[] }>>;

export function looksLikeProductUrl(url: string) {
  return /\/(?:products?|p)\//i.test(new URL(url).pathname);
}

export function hasProductEvidence(content: NormalizedContent) {
  const schemas = JSON.stringify(content.structuredData).toLowerCase();
  const structuredProduct = schemas.includes('"@type":"product"') || schemas.includes('"@type": "product"');
  const commerceAction = content.buttons.some((button) => /\b(?:add to cart|buy now|select options?|choose options?)\b/i.test(button));
  return structuredProduct || content.prices.length > 0 || content.variants.length > 0 || commerceAction;
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
  if (looksLikeProductUrl(url) && content.controls.loginWall && !hasProductEvidence(content)) {
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
  for (const [pattern, type, reason] of pathRules) if (pattern.test(path)) add(scores, type, 8, reason);

  for (const signal of detectPolicySignals(url, content)) {
    const type = signal === "RESEARCH_USE" || signal === "AGE" || signal === "PROMOTION" ? "POLICY" : signal;
    add(scores, type, 9, `${signal.toLowerCase().replaceAll("_", "-")} policy signal`);
  }

  const schemas = JSON.stringify(content.structuredData).toLowerCase();
  if (schemas.includes('"@type":"product"') || schemas.includes('"@type": "product"')) add(scores, "PRODUCT", 10, "Product structured data");
  if (content.prices.length && content.productName) add(scores, "PRODUCT", 4, "product name and price signals");
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
  const runnerUp = ordered[1]?.[1].score ?? 0;
  const confidence = Math.min(0.99, 0.52 + winner.score * 0.025 + Math.max(0, winner.score - runnerUp) * 0.015);
  return { pageType, confidence: Number(confidence.toFixed(2)), reasons: winner.reasons };
}
