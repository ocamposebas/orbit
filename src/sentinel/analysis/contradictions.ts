import type { CandidateFinding, NormalizedContent, SentinelPageType } from "@/sentinel/types";
import { analyzeClaim } from "./semantic";

interface PageInput { url: string; pageType: SentinelPageType; content: NormalizedContent; httpStatus?: number }
const researchPositioning = /\b(research use only|for research purposes only|not for human (?:use|consumption)|laboratory (?:use|research|analysis)|analytical (?:use|reference))\b/i;
const cosmeticExclusion = /\bnot intended for cosmetic use\b/i;
const cosmeticPositioning = /\b(cosmetic|cream|skin|beauty|topical)\b/i;

export function evaluateContradictions(pages: PageInput[]): CandidateFinding[] {
  const findings: CandidateFinding[] = [];
  const usablePages = pages.filter((page) => page.httpStatus === undefined || page.httpStatus < 400);
  const positioningPage = usablePages.find((page) => researchPositioning.test(page.content.visibleText));
  if (positioningPage) {
    for (const page of usablePages) {
      const claim = page.content.claims.find((text) => analyzeClaim(text).consumerDirected);
      if (claim) findings.push({ ruleKey: "POSITION-CONFLICT-001", severity: "HIGH", confidence: 0.94, status: "NEEDS_REVIEW", category: "Positioning conflict", title: "Research positioning conflicts with consumer language", description: "A site-level research statement conflicts with consumer-directed language elsewhere in the catalog or marketing content.", url: page.url, pageType: page.pageType, detectedText: claim, reason: `Research positioning was observed on ${new URL(positioningPage.url).pathname}, while this page contains a consumer-directed outcome signal.`, recommendedAction: "Review the two statements together and make the merchant positioning consistent across the public website.", scoreComponent: "OPERATIONAL_CONSISTENCY" });
      if (page.pageType === "PRODUCT" && !researchPositioning.test(page.content.visibleText)) findings.push({ ruleKey: "RSRCH-DISC-001", severity: "MEDIUM", confidence: 0.86, status: "NEEDS_REVIEW", category: "Research controls", title: "Research-use disclosure not detected on product page", description: "The site presents a research-only position, but this product page does not expose recognizable research-use language in its primary content.", url: page.url, pageType: page.pageType, reason: `Research positioning was observed on ${new URL(positioningPage.url).pathname}, but not in this product page's primary content.`, recommendedAction: "Review whether the product page should display clear, prominent research-use and non-human-use language consistent with the site position.", scoreComponent: "RESEARCH_CONTROLS" });
    }
  }
  const exclusionPage = usablePages.find((page) => cosmeticExclusion.test(page.content.visibleText));
  if (exclusionPage) for (const page of usablePages.filter((item) => item.pageType === "PRODUCT" && cosmeticPositioning.test(`${item.content.productName} ${item.content.visibleText}`))) findings.push({ ruleKey: "POSITION-COSMETIC-001", severity: "HIGH", confidence: 0.91, status: "NEEDS_REVIEW", category: "Positioning conflict", title: "Product positioning conflicts with site policy", description: "A product appears positioned for cosmetic use while another public page excludes that use.", url: page.url, pageType: page.pageType, detectedText: page.content.productName, reason: `The catalog language conflicts with the exclusion observed on ${new URL(exclusionPage.url).pathname}.`, recommendedAction: "Review product naming, description and site-level policy as one consistent position.", scoreComponent: "OPERATIONAL_CONSISTENCY" });
  for (const page of usablePages.filter((item) => item.pageType === "PRODUCT")) {
    const headingValues = [...`${page.content.productName ?? ""} ${page.content.headings.join(" ")}`.matchAll(/\b\d+(?:\.\d+)?\s*(?:mcg|mg|g|ml)\b/gi)].map((match) => match[0].toLowerCase().replace(/\s/g, ""));
    const bodyValues = [...page.content.paragraphs.join(" ").matchAll(/\b\d+(?:\.\d+)?\s*(?:mcg|mg|g|ml)\b/gi)].map((match) => match[0].toLowerCase().replace(/\s/g, ""));
    const variants = page.content.variants.flatMap((value) => [...value.matchAll(/\b\d+(?:\.\d+)?\s*(?:mcg|mg|g|ml)\b/gi)].map((match) => match[0].toLowerCase().replace(/\s/g, "")));
    const headingSet = new Set(headingValues); const bodySet = new Set(bodyValues); const variantSet = new Set(variants);
    const hasSharedValue = [...headingSet].some((value) => bodySet.has(value));
    const allDeclaredAsVariants = [...new Set([...headingSet, ...bodySet])].every((value) => variantSet.has(value));
    const distinct = [...new Set([...headingSet, ...bodySet])];
    if (headingSet.size && bodySet.size && !hasSharedValue && !allDeclaredAsVariants) findings.push({ ruleKey: "PRODUCT-CONCENTRATION-001", severity: "MEDIUM", confidence: 0.84, status: "NEEDS_REVIEW", category: "Product consistency", title: "Potential concentration mismatch", description: "The concentration shown in the product identity does not match any concentration observed in the descriptive copy.", url: page.url, pageType: page.pageType, detectedText: distinct.join(" / "), reason: "No shared concentration was found between the product heading and body, and the values were not all represented as declared variants.", recommendedAction: "Verify the product heading, selected variants, structured data and descriptive copy against the source product record.", scoreComponent: "PRODUCT_INTEGRITY" });
  }
  return findings;
}
