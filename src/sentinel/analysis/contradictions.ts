import type { CandidateFinding, NormalizedContent, SentinelPageType } from "@/sentinel/types";
import { analyzeClaim } from "./semantic";
import { analyzeContext } from "./contextual-signals";

interface PageInput { url: string; pageType: SentinelPageType; content: NormalizedContent; httpStatus?: number }
const researchPositioning = /\b(research use only|for research purposes only|not for human (?:use|consumption)|laboratory (?:use|research|analysis)|analytical (?:use|reference))\b/i;
const cosmeticExclusion = /\bnot intended for cosmetic use\b/i;
const cosmeticPositioning = /\b(cosmetic|cream|skin|beauty|topical)\b/i;

function researchEvidence(page: PageInput) {
  const candidates = [...page.content.disclaimers, ...page.content.paragraphs];
  return candidates.find((text) => analyzeContext(text).type === "RESEARCH_RESTRICTION") ?? candidates.find((text) => researchPositioning.test(text));
}

export function evaluateContradictions(pages: PageInput[]): CandidateFinding[] {
  const findings: CandidateFinding[] = [];
  const usablePages = pages.filter((page) => page.httpStatus === undefined || page.httpStatus < 400);
  const positioningPage = usablePages.find((page) => Boolean(researchEvidence(page)));
  if (positioningPage) {
    const positioningEvidence = researchEvidence(positioningPage)!;
    for (const page of usablePages) {
      const analyses = page.content.claims.map((text) => ({ text, analysis: analyzeClaim(text) })).filter(({ analysis }) => analysis.consumerDirected && analysis.risk !== "none").sort((left, right) => right.analysis.confidence - left.analysis.confidence);
      const material = analyses[0];
      if (material) {
        const confidence = Number(Math.min(0.96, material.analysis.confidence).toFixed(2));
        const severity = material.analysis.risk === "critical" && confidence >= 0.9 ? "CRITICAL" as const : "HIGH" as const;
        findings.push({ ruleKey: "POSITION-CONFLICT-001", severity, confidence, status: "NEEDS_REVIEW", category: "Positioning conflict", title: "Research positioning conflicts with consumer language", description: "Explicit research-use restrictions conflict with a separate, materially consumer-directed statement.", url: page.url, pageType: page.pageType, detectedText: material.text, secondaryEvidence: { url: positioningPage.url, text: positioningEvidence, role: "research-positioning" }, reason: `Evidence A contains a material ${material.analysis.signalType?.toLowerCase().replaceAll("_", " ") ?? "consumer"} signal; Evidence B on ${new URL(positioningPage.url).pathname} establishes research-only positioning.`, recommendedAction: "Review both evidence records together and align the public product language with the declared research-only position.", scoreComponent: "OPERATIONAL_CONSISTENCY" });
      }
    }
    const productPages = usablePages.filter((page) => page.pageType === "PRODUCT");
    const missingDisclosure = productPages.filter((page) => !researchEvidence(page));
    if (productPages.length && missingDisclosure.length) {
      const covered = productPages.length - missingDisclosure.length;
      findings.push({ ruleKey: "RSRCH-COVERAGE-001", severity: covered === 0 ? "HIGH" : "MEDIUM", confidence: 0.9, status: "NEEDS_REVIEW", category: "Research controls", title: "Research-use coverage is incomplete across product pages", description: `Recognizable research-use restrictions were observed on ${covered} of ${productPages.length} scanned product pages.`, url: missingDisclosure[0].url, pageType: "PRODUCT", secondaryEvidence: { url: positioningPage.url, text: positioningEvidence, role: "site-positioning" }, affectedUrls: missingDisclosure.map((page) => page.url), reason: "The site establishes a research-only position, but that restriction is not consistently present in each product page's primary content.", recommendedAction: "Review the affected product pages and apply consistent, prominent research-use restrictions where appropriate.", scoreComponent: "RESEARCH_CONTROLS" });
    }
  }
  const exclusionPage = usablePages.find((page) => cosmeticExclusion.test(page.content.visibleText));
  if (exclusionPage) for (const page of usablePages.filter((item) => item.pageType === "PRODUCT" && cosmeticPositioning.test(`${item.content.productName} ${item.content.visibleText}`))) findings.push({ ruleKey: "POSITION-COSMETIC-001", severity: "HIGH", confidence: 0.91, status: "NEEDS_REVIEW", category: "Positioning conflict", title: "Product positioning conflicts with site policy", description: "A product appears positioned for cosmetic use while another public page excludes that use.", url: page.url, pageType: page.pageType, detectedText: page.content.productName, reason: `The catalog language conflicts with the exclusion observed on ${new URL(exclusionPage.url).pathname}.`, recommendedAction: "Review product naming, description and site-level policy as one consistent position.", scoreComponent: "OPERATIONAL_CONSISTENCY" });
  for (const page of usablePages.filter((item) => item.pageType === "PRODUCT")) {
    const readMeasurements = (text: string) => [...text.matchAll(/\b\d+(?:\.\d+)?\s*(mcg|mg|g|ml)\b/gi)].map((match) => ({ value: match[0].toLowerCase().replace(/\s/g, ""), unit: match[1].toLowerCase() }));
    const headingMeasurements = readMeasurements(`${page.content.productName ?? ""} ${page.content.headings.join(" ")}`);
    const headingUnits = new Set(headingMeasurements.map((measurement) => measurement.unit));
    const headingValues = headingMeasurements.map((measurement) => measurement.value);
    const bodyValues = readMeasurements(page.content.paragraphs.join(" ")).filter((measurement) => headingUnits.has(measurement.unit)).map((measurement) => measurement.value);
    const variants = page.content.variants.flatMap(readMeasurements).filter((measurement) => headingUnits.has(measurement.unit)).map((measurement) => measurement.value);
    const headingSet = new Set(headingValues); const bodySet = new Set(bodyValues); const variantSet = new Set(variants);
    const hasSharedValue = [...headingSet].some((value) => bodySet.has(value));
    const allDeclaredAsVariants = [...new Set([...headingSet, ...bodySet])].every((value) => variantSet.has(value));
    const distinct = [...new Set([...headingSet, ...bodySet])];
    if (headingSet.size && bodySet.size && !hasSharedValue && !allDeclaredAsVariants) findings.push({ ruleKey: "PRODUCT-CONCENTRATION-001", severity: "MEDIUM", confidence: 0.84, status: "NEEDS_REVIEW", category: "Product consistency", title: "Potential concentration mismatch", description: "The concentration shown in the product identity does not match any concentration observed in the descriptive copy.", url: page.url, pageType: page.pageType, detectedText: distinct.join(" / "), reason: "No shared concentration was found between the product heading and body, and the values were not all represented as declared variants.", recommendedAction: "Verify the product heading, selected variants, structured data and descriptive copy against the source product record.", scoreComponent: "PRODUCT_INTEGRITY" });
  }
  return findings;
}
