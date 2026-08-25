import type { NormalizedContent } from "@/sentinel/types";

export const compoundAbbreviations: Readonly<Record<string, string>> = {
  Retatrutide: "RT",
  Tirzepatide: "TZ",
  Cagrilintide: "CAG",
  Tesamorelin: "TS",
  "BPC-157": "BPC",
  "TB-500": "TB",
  "GHK-Cu": "GHK",
};

const brandPrefixOverrides: Array<[RegExp, string]> = [[/\bphase\s+one\s+labz?\b/i, "PL"], [/\brgv\s*prime\b/i, "RG"]];

export function deterministicAbbreviation(name: string): string {
  const normalized = name.normalize("NFKD").replace(/[^a-zA-Z0-9\s-]/g, " ").trim();
  if (!normalized) return "PRD";
  const words = normalized.split(/[\s-]+/).filter(Boolean);
  if (words.length > 1) return words.map((word) => word[0]).join("").slice(0, 5).toUpperCase();
  const letters = normalized.replace(/[^a-zA-Z]/g, "");
  const consonants = letters.replace(/[aeiou]/gi, "");
  return (consonants.length >= 2 ? consonants : letters).slice(0, Math.min(5, Math.max(2, consonants.length))).toUpperCase() || "PRD";
}

export function inferBrandPrefix(businessName: string): string {
  const override = brandPrefixOverrides.find(([pattern]) => pattern.test(businessName));
  if (override) return override[1];
  return deterministicAbbreviation(businessName).slice(0, 3);
}

export function findCanonicalCompound(content: NormalizedContent): string | undefined {
  const evidence = `${content.productName ?? ""} ${content.visibleText} ${content.images.map((image) => `${image.filename} ${image.alt}`).join(" ")} ${content.certificateLinks.join(" ")}`;
  return Object.keys(compoundAbbreviations).find((name) => new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("-", "[- ]?"), "i").test(evidence));
}

export function buildProductIntelligence(content: NormalizedContent, url: string, businessName: string) {
  const canonicalCompoundName = findCanonicalCompound(content);
  const brandPrefix = inferBrandPrefix(businessName);
  const abbreviation = canonicalCompoundName ? compoundAbbreviations[canonicalCompoundName] : deterministicAbbreviation(content.productName ?? new URL(url).pathname.split("/").pop() ?? "Product");
  const concentration = [...`${content.productName ?? ""} ${content.headings.join(" ")} ${content.variants.join(" ")}`.matchAll(/\b\d+(?:\.\d+)?\s*(?:mcg|mg|g|ml|units?)\b/gi)].map((match) => match[0]).at(0);
  const displayCatalogName = `${brandPrefix}-${abbreviation}`;
  const normalizedConcentration = concentration?.replace(/\s+/g, "").toUpperCase();
  return {
    canonicalCompoundName,
    displayCatalogName: content.productName,
    recommendedDisplayIdentifier: displayCatalogName,
    existingSku: content.sku,
    suggestedSku: [displayCatalogName, normalizedConcentration].filter(Boolean).join("-"),
    suggestedSlug: `/product/${displayCatalogName.toLowerCase()}`,
    slug: new URL(url).pathname,
    shortDescription: content.descriptions.short,
    fullDescription: content.descriptions.full ?? content.paragraphs.join(" "),
    description: content.descriptions.full ?? content.paragraphs.join(" "),
    variants: content.productVariations.length ? content.productVariations : content.variants.map((name) => ({ name })),
    categories: content.productCategories,
    tags: content.productTags,
    concentration,
    researchUseText: content.disclaimers,
    claims: content.claims,
    images: content.images,
    ctas: [...content.buttons, ...content.linkCtas.map((cta) => cta.text)],
    stockText: content.stockText.map((item) => item.text),
    certificateUrls: content.certificateLinks,
    metadata: content.metadata,
    structuredData: content.structuredData,
    breadcrumbs: content.breadcrumbs,
    recommendationOnly: true,
    canonicalIdentityRetained: true,
  };
}
