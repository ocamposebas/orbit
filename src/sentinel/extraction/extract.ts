import * as cheerio from "cheerio";
import { normalizedContentSchema, type NormalizedContent } from "@/sentinel/types";
import { normalizeText, splitSentences, stableUnique } from "./normalize";

const claimTerms = /\b(weight loss|fat loss|burn fat|metabolism|treat|cure|heal|diagnos|dose|dosage|inject|injection|twice weekly|appetite|anti-aging|performance|body transformation)\b/i;
const disclaimerTerms = /\b(not intended|research use only|for research|disclaimer|not for human|consult|results may vary)\b/i;

function toAbsolute(value: string | undefined, baseUrl: string): string {
  if (!value) return "";
  try { return new URL(value, baseUrl).toString(); } catch { return ""; }
}

export function extractNormalizedContent(html: string, url: string): NormalizedContent {
  const $ = cheerio.load(html);
  const linkRecords = $("a[href]").map((_, element) => ({ href: toAbsolute($(element).attr("href"), url), text: normalizeText($(element).text()), rel: $(element).attr("rel") })).get().filter((item) => item.href);
  const forms = $("form").map((_, element) => ({
    action: toAbsolute($(element).attr("action") || url, url),
    method: ($(element).attr("method") ?? "GET").toUpperCase(),
    fields: $(element).find("input,select,textarea").map((__, field) => ({ name: $(field).attr("name") ?? "", type: $(field).attr("type") ?? field.tagName, required: $(field).is("[required]") })).get(),
  })).get();
  const structuredData = $("script[type='application/ld+json']").map((_, element) => { try { return JSON.parse($(element).text()); } catch { return null; } }).get().filter(Boolean);
  const technologies: string[] = [];
  const source = html.toLowerCase();
  if (source.includes("cdn.shopify.com") || source.includes("shopify-section")) technologies.push("Shopify");
  if (source.includes("woocommerce") || source.includes("wp-content/plugins/woocommerce")) technologies.push("WooCommerce");
  if (source.includes("__next_data__") || source.includes("/_next/")) technologies.push("Next.js");
  if (source.includes("astro-island")) technologies.push("Astro");
  const controlText = normalizeText($("body").text()).toLowerCase();
  const controls = {
    ageGate: /(?:are you|confirm).{0,30}(?:18|21|legal age)/i.test(controlText),
    cookieBanner: /(?:accept|manage).{0,25}cookies/i.test(controlText),
    loginWall: /(?:sign in|log in).{0,40}(?:continue|view|access)/i.test(controlText) && $("input[type='password']").length > 0,
    modal: $("[role='dialog'], dialog, [aria-modal='true']").length > 0,
  };
  $("script,style,noscript,svg,template,iframe").remove();
  $("[hidden],[aria-hidden='true']").remove();
  const title = normalizeText($("title").first().text() || $("h1").first().text());
  const headings = stableUnique($("h1,h2,h3").map((_, element) => $(element).text()).get());
  const paragraphs = stableUnique($("main p, article p, [role='main'] p, body p").map((_, element) => $(element).text()).get());
  const buttons = stableUnique($("button,[role='button'],input[type='submit']").map((_, element) => $(element).text() || $(element).attr("value") || "").get());
  const contentRoot = $("main,article,[role='main']").first().length ? $("main,article,[role='main']").first() : $("body");
  const visibleBlocks = contentRoot.find("h1,h2,h3,h4,p,li,blockquote,label,button").map((_, element) => normalizeText($(element).text())).get().filter(Boolean);
  const visibleText = normalizeText(visibleBlocks.join(" ") || contentRoot.text());
  const sentences = stableUnique(visibleBlocks.flatMap((block) => splitSentences(block)));
  const prices = stableUnique(visibleText.match(/(?:\$|USD\s*)\d{1,6}(?:[.,]\d{2})?/g) ?? []);
  const claims = sentences.filter((sentence) => claimTerms.test(sentence));
  const disclaimers = sentences.filter((sentence) => disclaimerTerms.test(sentence));
  const productSchema = structuredData.flatMap((entry) => Array.isArray(entry) ? entry : [entry]).find((entry) => typeof entry === "object" && entry && String((entry as Record<string, unknown>)["@type"]).toLowerCase().includes("product")) as Record<string, unknown> | undefined;
  const productName = typeof productSchema?.name === "string" ? productSchema.name : $("h1").first().text();
  const sku = typeof productSchema?.sku === "string" ? productSchema.sku : undefined;
  const variantValues = $("select[name*='variant'],select[name*='option'] option").map((_, el) => $(el).text()).get();
  return normalizedContentSchema.parse({ title, headings, paragraphs, visibleText, buttons, links: linkRecords, forms, structuredData, prices, productName: normalizeText(productName ?? "") || undefined, sku, variants: stableUnique(variantValues), claims, disclaimers, technologies, controls });
}
