import * as cheerio from "cheerio";
import { normalizedContentSchema, type NormalizedContent } from "@/sentinel/types";
import { normalizeText, splitSentences, stableUnique } from "./normalize";

const claimTerms = /\b(weight[- ]?loss|fat[- ]?loss|burn(?:s|ing)? fat|metaboli(?:sm|c)|adiposity|obesity|appetite|muscle (?:growth|gain|building)|hypertroph\w*|cognitive(?: (?:enhancement|performance|function))?|memory(?: enhancement)?|neuroprotect\w*|human performance|reproductive(?: (?:health|function|outcomes?))?|fertility|recovery|longevity|anti[- ]aging|body composition|treat\w*|cur(?:e|es|ed|ing)|heal\w*|diagnos\w*|prevent\w*|mitigat\w*|dose|dosage|inject|injection|consume|consumption|swallow|sublingual|oral use|topical use|apply topically|serving size|take (?:one|two|three|\d+)|(?:once|twice) (?:daily|weekly)|daily use|for human use|personal use|patient|prescription|pharmacy|telemedicine|before and after|transformation|performance|body transformation|reconstitut|bacteriostatic|syringe|needle)\b/i;
const disclaimerTerms = /\b(not intended|research use only|for research|research purposes only|laboratory (?:use|research|analysis)|analytical (?:use|reference)|disclaimer|not for human|not (?:a|an) (?:(?:compounding|retail) )?(?:pharmacy|medical provider)|do not (?:consume|ingest|inject|use on humans?)|does not (?:provide|make|support|authorize|endorse|claim)|do not constitute|must not be used|nothing .{0,100}(?:interpreted|construed)|consult|results may vary)\b/i;

function toAbsolute(value: string | undefined, baseUrl: string): string {
  if (!value) return "";
  try { return new URL(value, baseUrl).toString(); } catch { return ""; }
}

function selectorFor($: cheerio.CheerioAPI, element: Parameters<cheerio.CheerioAPI>[0]) {
  const node = $(element);
  const id = node.attr("id");
  if (id) return `#${id.replace(/[^a-zA-Z0-9_-]/g, "\\$&")}`;
  const tag = typeof element === "object" && element && "tagName" in element ? String(element.tagName).toLowerCase() : "*";
  const classes = (node.attr("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((value) => `.${value.replace(/[^a-zA-Z0-9_-]/g, "\\$&")}`).join("");
  const parent = node.parent();
  const siblings = parent.children(tag);
  const position = siblings.length > 1 ? `:nth-of-type(${siblings.index(node) + 1})` : "";
  return `${tag}${classes}${position}`;
}

function queryParams(url: string) {
  const params: Record<string, string[]> = {};
  try { for (const [key, value] of new URL(url).searchParams) (params[key] ??= []).push(value); } catch { /* invalid URL remains empty */ }
  return params;
}

function firstStructuredString(value: unknown, keys: string[]): string | undefined {
  if (Array.isArray(value)) return value.map((item) => firstStructuredString(item, keys)).find(Boolean);
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) if (typeof record[key] === "string" && String(record[key]).trim()) return String(record[key]);
  return Object.values(record).map((item) => firstStructuredString(item, keys)).find(Boolean);
}

function structuredProducts(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(structuredProducts);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const type = Array.isArray(record["@type"]) ? record["@type"].join(" ") : String(record["@type"] ?? "");
  return [...(/\bproduct\b/i.test(type) ? [record] : []), ...Object.values(record).flatMap(structuredProducts)];
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

export function extractNormalizedContent(html: string, url: string, options: { originalUrl?: string; renderedVisibleText?: string; interactiveStates?: Array<{ kind: string; label: string; selector: string }> } = {}): NormalizedContent {
  const $ = cheerio.load(html);
  const linkRecords = $("a[href]").map((_, element) => ({ href: toAbsolute($(element).attr("href"), url), text: normalizeText($(element).text()), rel: $(element).attr("rel") })).get().filter((item) => item.href);
  const structuredData = $("script[type='application/ld+json']").map((_, element) => { try { return JSON.parse($(element).text()); } catch { return null; } }).get().filter(Boolean);
  const openGraph: Record<string, string> = {};
  $("meta[property^='og:']").each((_, element) => { const key = normalizeText($(element).attr("property") ?? ""); const value = normalizeText($(element).attr("content") ?? ""); if (key && value) openGraph[key] = value; });
  const metadata = { title: normalizeText($("title").first().text()), description: normalizeText($("meta[name='description']").attr("content") ?? ""), openGraphTitle: normalizeText(openGraph["og:title"] ?? ""), openGraphDescription: normalizeText(openGraph["og:description"] ?? "") };
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
  const headingRecords = contentRoot.find("h1,h2,h3,h4,h5,h6").map((_, element) => ({ text: normalizeText($(element).text()), level: Number(element.tagName.slice(1)), selector: selectorFor($, element) })).get().filter((item) => item.text);
  const headings = stableUnique(headingRecords.map((item) => item.text));
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
  const documentPattern = /(?:\.pdf(?:$|[?#])|coa|certificate|lab[-_ ]?report|testing[-_ ]?document|supporting[-_ ]?document)/i;
  const embeddedDocuments = $("a[href],iframe[src],embed[src],object[data]").map((_, element) => {
    const raw = $(element).attr("href") || $(element).attr("src") || $(element).attr("data");
    const documentUrl = toAbsolute(raw, url);
    const text = normalizeText($(element).text() || $(element).attr("title") || $(element).attr("aria-label") || "");
    const combined = `${documentUrl} ${text}`;
    if (!documentPattern.test(combined)) return null;
    return { url: documentUrl, text, selector: selectorFor($, element), documentType: /\.pdf(?:$|[?#])/i.test(documentUrl) ? "PDF" : /coa/i.test(combined) ? "COA" : /certificate/i.test(combined) ? "CERTIFICATE" : "DOCUMENT" };
  }).get().filter((item): item is { url: string; text: string; selector: string; documentType: string } => Boolean(item?.url));
  const certificateLinks = stableUnique(embeddedDocuments.filter((item) => /COA|CERTIFICATE|LAB|PDF/.test(item.documentType) || /(?:coa|certificate|lab[-_ ]?report)/i.test(`${item.url} ${item.text}`)).map((item) => item.url));
  const visibleBlocks = contentRoot.find("h1,h2,h3,h4,h5,h6,p,li,blockquote,label,button,figcaption,dt,dd").map((_, element) => normalizeText($(element).text())).get().filter(Boolean);
  const visibleText = normalizeText(options.renderedVisibleText || visibleBlocks.join(" ") || contentRoot.text());
  const navigation = $("nav a[href],header a[href],[role='navigation'] a[href]").map((_, element) => ({ text: normalizeText($(element).text() || $(element).attr("aria-label") || ""), selector: selectorFor($, element), href: toAbsolute($(element).attr("href"), url) })).get().filter((item) => item.text);
  const footer = $("footer h1,footer h2,footer h3,footer h4,footer h5,footer h6,footer p,footer li,footer a,footer button,[role='contentinfo'] p,[role='contentinfo'] a").map((_, element) => ({ text: normalizeText($(element).text()), selector: selectorFor($, element), href: $(element).is("a") ? toAbsolute($(element).attr("href"), url) : undefined })).get().filter((item) => item.text);
  const linkCtas = $("a[href]").map((_, element) => {
    const text = normalizeText($(element).text() || $(element).attr("aria-label") || "");
    const role = `${$(element).attr("class") ?? ""} ${$(element).attr("role") ?? ""}`;
    return /\b(?:buy|shop|order|add to cart|learn more|view|browse|get started|continue|checkout|select|choose|download)\b/i.test(text) || /button|btn|cta/i.test(role) ? { text, selector: selectorFor($, element), href: toAbsolute($(element).attr("href"), url) } : null;
  }).get().filter((item): item is { text: string; selector: string; href: string } => Boolean(item?.text));
  const badges = $("[class*='badge' i],[class*='pill' i],[class*='tag' i],[data-badge],[aria-label*='badge' i]").map((_, element) => ({ text: normalizeText($(element).text() || $(element).attr("aria-label") || ""), selector: selectorFor($, element) })).get().filter((item) => item.text);
  const stockText = contentRoot.find("[class*='stock' i],[class*='availability' i],[itemprop='availability']").map((_, element) => ({ text: normalizeText($(element).text() || $(element).attr("content") || ""), selector: selectorFor($, element) })).get().filter((item) => item.text);
  const checkoutText = contentRoot.find("[class*='checkout' i],[class*='payment' i],[id*='checkout' i],[id*='payment' i]").map((_, element) => ({ text: normalizeText($(element).text()), selector: selectorFor($, element) })).get().filter((item) => item.text && item.text.length <= 2_000);
  const domEvidence = contentRoot.find("h1,h2,h3,h4,h5,h6,p,li,blockquote,label,button,[role='button'],a[href],img[alt],figcaption,dt,dd").map((_, element) => {
    const text = normalizeText(element.tagName === "img" ? $(element).attr("alt") ?? "" : $(element).text() || $(element).attr("aria-label") || "");
    const evidenceType = /^h[1-6]$/.test(element.tagName) ? "HEADING" : element.tagName === "a" ? "LINK" : element.tagName === "img" ? "IMAGE_ALT" : element.tagName === "button" || $(element).attr("role") === "button" ? "CTA" : "VISIBLE_TEXT";
    return { text, selector: selectorFor($, element), evidenceType };
  }).get().filter((item) => item.text);
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
  const productSchema = structuredData.flatMap(structuredProducts)[0];
  const productName = typeof productSchema?.name === "string" ? productSchema.name : $("h1").first().text();
  const sku = typeof productSchema?.sku === "string" ? productSchema.sku : normalizeText($("[itemprop='sku'],[data-sku]").first().attr("content") || $("[itemprop='sku'],[data-sku]").first().attr("data-sku") || $("[itemprop='sku'],[data-sku]").first().text()) || undefined;
  const productVariations = $("select[name*='variant'] option,select[name*='option'] option,[data-variant-value]").map((_, element) => ({ name: normalizeText($(element).attr("data-variant-value") || $(element).text()), value: $(element).attr("value") || undefined, sku: $(element).attr("data-sku") || undefined, price: $(element).attr("data-price") || undefined, availability: $(element).attr("data-availability") || undefined })).get().filter((item) => item.name);
  const schemaCategory = firstStructuredString(productSchema, ["category"]);
  const productCategories = stableUnique([...(schemaCategory ? schemaCategory.split(/[,>|]/) : []), ...linkRecords.filter((link) => /\/(?:collections?|categor(?:y|ies))\//i.test(link.href)).map((link) => link.text), ...breadcrumbs.slice(0, -1)]);
  const productTags = stableUnique($("a[rel~='tag'],[class*='product-tag' i],[data-product-tag]").map((_, element) => normalizeText($(element).text() || $(element).attr("data-product-tag") || "")).get());
  const shortDescription = normalizeText($(".woocommerce-product-details__short-description,[class*='short-description' i],[data-short-description]").first().text() || (typeof productSchema?.description === "string" ? productSchema.description : "")) || undefined;
  const fullDescription = normalizeText($(".woocommerce-Tabs-panel--description,[class*='product-description' i],[data-product-description],[itemprop='description']").first().text() || (paragraphs.length ? paragraphs.join(" ") : "")) || undefined;
  const finalLocation = new URL(url);
  return normalizedContentSchema.parse({ title, headings, paragraphs, visibleText, buttons, links: linkRecords, forms, structuredData, prices, productName: normalizeText(productName ?? "") || undefined, sku, variants: stableUnique(productVariations.map((item) => item.name)), claims, disclaimers, technologies, images, breadcrumbs, certificateLinks, metadata, controls, location: { originalUrl: options.originalUrl ?? url, finalUrl: url, pathname: finalLocation.pathname, queryParams: queryParams(url) }, headingRecords, navigation, footer, linkCtas, badges, stockText, checkoutText, embeddedDocuments, descriptions: { short: shortDescription, full: fullDescription }, productCategories, productTags, productVariations, openGraph, interactiveStates: options.interactiveStates ?? [], domEvidence });
}
