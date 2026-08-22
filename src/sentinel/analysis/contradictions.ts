import type { CandidateFinding, NormalizedContent, SentinelPageType } from "@/sentinel/types";
import { analyzeClaim } from "./semantic";

interface PageInput { url: string; pageType: SentinelPageType; content: NormalizedContent }
const researchPositioning = /\b(research use only|not for human (?:use|consumption)|laboratory (?:research|analysis))\b/i;
const cosmeticExclusion = /\bnot intended for cosmetic use\b/i;
const cosmeticPositioning = /\b(cosmetic|cream|skin|beauty|topical)\b/i;

export function evaluateContradictions(pages: PageInput[]): CandidateFinding[] {
  const findings: CandidateFinding[] = [];
  const positioningPage = pages.find((page) => ["HOME", "POLICY", "TERMS"].includes(page.pageType) && researchPositioning.test(page.content.visibleText));
  if (positioningPage) {
    for (const page of pages) {
      const claim = page.content.claims.find((text) => analyzeClaim(text).consumerDirected);
      if (claim) findings.push({ ruleKey: "POSITION-CONFLICT-001", severity: "HIGH", confidence: 0.94, status: "NEEDS_REVIEW", category: "Positioning conflict", title: "Research positioning conflicts with consumer language", description: "A site-level research statement conflicts with consumer-directed language elsewhere in the catalog or marketing content.", url: page.url, pageType: page.pageType, detectedText: claim, reason: `Research positioning was observed on ${new URL(positioningPage.url).pathname}, while this page contains a consumer-directed outcome signal.`, recommendedAction: "Review the two statements together and make the merchant positioning consistent across the public website.", scoreComponent: "OPERATIONAL_CONSISTENCY" });
    }
  }
  const exclusionPage = pages.find((page) => cosmeticExclusion.test(page.content.visibleText));
  if (exclusionPage) for (const page of pages.filter((item) => item.pageType === "PRODUCT" && cosmeticPositioning.test(`${item.content.productName} ${item.content.visibleText}`))) findings.push({ ruleKey: "POSITION-COSMETIC-001", severity: "HIGH", confidence: 0.91, status: "NEEDS_REVIEW", category: "Positioning conflict", title: "Product positioning conflicts with site policy", description: "A product appears positioned for cosmetic use while another public page excludes that use.", url: page.url, pageType: page.pageType, detectedText: page.content.productName, reason: `The catalog language conflicts with the exclusion observed on ${new URL(exclusionPage.url).pathname}.`, recommendedAction: "Review product naming, description and site-level policy as one consistent position.", scoreComponent: "OPERATIONAL_CONSISTENCY" });
  for (const page of pages.filter((item) => item.pageType === "PRODUCT")) {
    const headingValues = [...`${page.content.productName ?? ""} ${page.content.headings.join(" ")}`.matchAll(/\b\d+(?:\.\d+)?\s*(?:mcg|mg|g|ml)\b/gi)].map((match) => match[0].toLowerCase().replace(/\s/g, ""));
    const bodyValues = [...page.content.paragraphs.join(" ").matchAll(/\b\d+(?:\.\d+)?\s*(?:mcg|mg|g|ml)\b/gi)].map((match) => match[0].toLowerCase().replace(/\s/g, ""));
    const distinct = [...new Set([...headingValues, ...bodyValues])];
    if (headingValues.length && bodyValues.length && distinct.length > 1) findings.push({ ruleKey: "PRODUCT-CONCENTRATION-001", severity: "HIGH", confidence: 0.89, status: "NEEDS_REVIEW", category: "Product consistency", title: "Potential concentration mismatch", description: "Different concentration values were detected across the same product page.", url: page.url, pageType: page.pageType, detectedText: distinct.join(" / "), reason: "The product title or heading and the descriptive content expose different concentration values.", recommendedAction: "Verify the product title, variants, structured data and descriptive copy against the source product record.", scoreComponent: "PRODUCT_INTEGRITY" });
  }
  return findings;
}
