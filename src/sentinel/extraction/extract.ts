import * as cheerio from "cheerio";
import { normalizedContentSchema, type NormalizedContent } from "@/sentinel/types";
import { normalizeText, splitSentences, stableUnique } from "./normalize";

const claimTerms = /\b(weight[- ]?loss|fat[- ]?loss|burn(?:s|ing)? fat|metaboli(?:sm|c)|adiposity|obesity|appetite|muscle (?:growth|gain)|cognitive(?: (?:enhancement|performance|function))?|memory enhancement|reproductive(?: (?:health|function|outcomes?))?|fertility|recovery|longevity|anti[- ]aging|body composition|treat\w*|cur(?:e|es|ed|ing)|heal\w*|diagnos\w*|prevent\w*|mitigat\w*|dose|dosage|inject|injection|consume|consumption|swallow|sublingual|oral use|topical use|apply topically|serving size|take (?:one|two|three|\d+)|(?:once|twice) (?:daily|weekly)|daily use|for human use|personal use|patient|prescription|pharmacy|telemedicine|before and after|transformation|performance|body transformation|reconstitut|bacteriostatic|syringe|needle)\b/i;
const disclaimerTerms = /\b(not intended|research use only|for research|research purposes only|laboratory (?:use|research|analysis)|analytical (?:use|reference)|disclaimer|not for human|not (?:a|an) (?:pharmacy|medical provider)|do not (?:consume|ingest|inject|use on humans?)|does not (?:provide|make|support|authorize|endorse|claim)|do not constitute|must not be used|nothing .{0,100}(?:interpreted|construed)|consult|results may vary)\b/i;

function toAbsolute(value: string | undefined, baseUrl: string): string {
  if (!value) return "";
  try { return new URL(value, baseUrl).toString(); } catch { return ""; }
}

function structuredCommercialText(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(structuredCommercialText);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const type = Array.isArray(record["@type"]) ? record["@type"].join(" ") : String(record["@type"] ?? "");
  const own = /product|collection|itemlist|listitem/i.test(type)
    ? [record.name, record.description].filter((item): item is string => typeof item === "string")
    : [];
  return [...own, ...Object.values(record).flatMap(structuredCommercialText)];
}

export function extractNormalizedContent(html: string, url: string): NormalizedContent {
  const $ = cheerio.load(html);
  const linkRecords = $("a[href]").map((_, element) => ({ href: toAbsolute($(element).attr("href"), url), text: normalizeText($(element).text()), rel: $(element).attr("rel") })).get().filter((item) => item.href);
  const structuredData = $("script[type='application/ld+json']").map((_, element) => { try { return JSON.parse($(element).text()); } catch { return null; } }).get().filter(Boolean);
  const metadata = { title: normalizeText($("title").first().text()), description: normalizeText($("meta[name='description']").attr("content") ?? ""), openGraphTitle: normalizeText($("meta[property='og:title']").attr("content") ?? ""), openGraphDescription: normalizeText($("meta[property='og:description']").attr("content") ?? "") };
  const technologies: string[] = [];
  const source = html.toLowerCase();
  if (source.includes("cdn.shopify.com") || source.includes("shopify-section")) technologies.push("Shopify");
  if (source.includes("woocommerce") || source.includes("wp-content/plugins/woocommerce")) technologies.push("WooCommerce");
  if (source.includes("__next_data__") || source.includes("/_next/")) technologies.push("Next.js");
  if (source.includes("astro-island")) technologies.push("Astro");
  const modal = $("[role='dialog'], dialog, [aria-modal='true']").length > 0;
  $("script,style,noscript,svg,template,iframe").remove();
  $("[hidden],[aria-hidden='true']").remove();
  const title = normalizeText($("title").first().text() || $("h1").first().text());
  const primaryRoot = $("main,article,[role='main']").first();
  const contentRoot = primaryRoot.length ? primaryRoot : $("body");
  const headings = stableUnique(contentRoot.find("h1,h2,h3").map((_, element) => $(element).text()).get());
  const paragraphs = stableUnique(contentRoot.find("p").map((_, element) => $(element).text()).get());
  const buttons = stableUnique(contentRoot.find("button,[role='button'],input[type='submit']").map((_, element) => $(element).text() || $(element).attr("value") || "").get());
  const forms = contentRoot.find("form").map((_, element) => ({
    action: toAbsolute($(element).attr("action") || url, url),
    method: ($(element).attr("method") ?? "GET").toUpperCase(),
    fields: $(element).find("input,select,textarea").map((__, field) => {
      const id = $(field).attr("id");
      const explicitLabel = id ? $("label[for]").filter((_, labelElement) => $(labelElement).attr("for") === id).first().text() : "";
      const label = normalizeText($(field).attr("aria-label") || explicitLabel || $(field).closest("label").text());
      return { name: $(field).attr("name") ?? "", label, type: $(field).attr("type") ?? field.tagName, required: $(field).is("[required]"), checked: $(field).is(":checked"), disabled: $(field).is(":disabled") };
    }).get(),
  })).get();
  const images = contentRoot.find("img[src]").map((_, element) => { const src = toAbsolute($(element).attr("src"), url); let filename = ""; try { filename = decodeURIComponent(new URL(src).pathname.split("/").pop() ?? ""); } catch { /* retain empty filename */ } return { src, filename, alt: normalizeText($(element).attr("alt") ?? ""), title: normalizeText($(element).attr("title") ?? "") }; }).get().filter((image) => image.src);
  const breadcrumbs = stableUnique(contentRoot.find("nav[aria-label*='breadcrumb' i] a,[class*='breadcrumb' i] a,[itemtype*='BreadcrumbList'] [itemprop='name']").map((_, element) => $(element).text()).get());
  const certificateLinks = stableUnique(linkRecords.filter((link) => /(?:coa|certificate|lab[-_ ]?report|testing[-_ ]?document)/i.test(`${link.href} ${link.text}`)).map((link) => link.href));
  const visibleBlocks = contentRoot.find("h1,h2,h3,h4,p,li,blockquote,label,button").map((_, element) => normalizeText($(element).text())).get().filter(Boolean);
  const visibleText = normalizeText(visibleBlocks.join(" ") || contentRoot.text());
  const controlText = visibleText.toLowerCase();
  const controls = {
    ageGate: /(?:are you|confirm).{0,30}(?:18|21|legal age)/i.test(controlText),
    cookieBanner: /(?:accept|manage).{0,25}cookies/i.test(normalizeText($("body").text())),
    loginWall: /(?:sign in|log in).{0,60}(?:continue|view|access|account)/i.test(controlText) && contentRoot.find("input[type='password']").length > 0,
    modal,
    researchGate: /(?:research (?:use|purposes?|qualification|acknowledg|attestation)|qualified researcher|laboratory use)/i.test(controlText) && contentRoot.find("input[type='checkbox']").length > 0,
    acknowledgementUnchecked: contentRoot.find("input[type='checkbox'][required]:not(:checked)").length > 0,
    continueInitiallyDisabled: contentRoot.find("button:disabled,input[type='submit']:disabled").length > 0,
  };
  const sentences = stableUnique(visibleBlocks.flatMap((block) => splitSentences(block)));
  const visiblePrices = visibleText.match(/(?:(?:US|CA|AU)?\$|USD|CAD|AUD|EUR|GBP|\u20ac|\u00a3)\s*\d{1,7}(?:[.,]\d{1,2})?/gi) ?? [];
  const metadataPrices = $("meta[property='product:price:amount'],meta[itemprop='price'],[itemprop='price']").map((_, element) => $(element).attr("content") || $(element).attr("value") || $(element).text()).get();
  const schemaPrices = JSON.stringify(structuredData).match(/"price"\s*:\s*"?(\d{1,7}(?:\.\d{1,2})?)/gi)?.map((value) => value.replace(/^.*:\s*"?/, "")) ?? [];
  const prices = stableUnique([...visiblePrices, ...metadataPrices, ...schemaPrices]);
  const commercialEvidence = [
    title,
    ...headings,
    ...sentences,
    ...linkRecords.map((link) => link.text),
    ...breadcrumbs,
    ...images.flatMap((image) => [image.alt, image.title]),
    metadata.title,
    metadata.description,
    metadata.openGraphTitle,
    metadata.openGraphDescription,
    ...structuredData.flatMap(structuredCommercialText),
  ];
  const claims = stableUnique(commercialEvidence).filter((text) => claimTerms.test(text));
  const disclaimers = sentences.filter((sentence) => disclaimerTerms.test(sentence));
  const productSchema = structuredData.flatMap((entry) => Array.isArray(entry) ? entry : [entry]).find((entry) => typeof entry === "object" && entry && String((entry as Record<string, unknown>)["@type"]).toLowerCase().includes("product")) as Record<string, unknown> | undefined;
  const productName = typeof productSchema?.name === "string" ? productSchema.name : $("h1").first().text();
  const sku = typeof productSchema?.sku === "string" ? productSchema.sku : undefined;
  const variantValues = $("select[name*='variant'] option,select[name*='option'] option,[data-variant-value]").map((_, el) => $(el).attr("data-variant-value") || $(el).text()).get();
  return normalizedContentSchema.parse({ title, headings, paragraphs, visibleText, buttons, links: linkRecords, forms, structuredData, prices, productName: normalizeText(productName ?? "") || undefined, sku, variants: stableUnique(variantValues), claims, disclaimers, technologies, images, breadcrumbs, certificateLinks, metadata, controls });
}
