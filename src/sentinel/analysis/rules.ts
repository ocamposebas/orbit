import type { CandidateFinding, NormalizedContent, SentinelPageType } from "@/sentinel/types";
import type { SemanticAnalyzer } from "./semantic";
import { detectPolicySignals, type PolicySignalType } from "@/sentinel/classification/policy-signals";
import { hasProductEvidence } from "@/sentinel/classification/classifier";

interface PageInput { url: string; pageType: SentinelPageType; content: NormalizedContent; httpStatus?: number }

export function isReviewableCheckout(page: Pick<PageInput, "url" | "pageType" | "content">) {
  if (page.pageType !== "CHECKOUT") return false;
  const path = new URL(page.url).pathname;
  if (/\/(?:checkout|order)(?:\/|[-_])(?:thank[-_]?you|confirmation|confirmed|complete|completed|receipt|success)(?:\/|$)/i.test(path)) return false;
  const fields = page.content.forms.flatMap((form) => form.fields);
  const hasCheckoutField = fields.some((field) => /(?:billing|shipping|payment|card|order|checkout|terms|research|age|address)/i.test(`${field.name} ${field.label}`));
  const hasCheckoutAction = page.content.buttons.some((button) => /\b(?:place|submit|complete) order\b|\bpay(?: now)?\b|continue to (?:payment|review)|complete checkout/i.test(button));
  const hasCheckoutSummary = /\b(?:order total|billing address|shipping address|payment method|review your order)\b/i.test(page.content.visibleText);
  return hasCheckoutField || hasCheckoutAction || hasCheckoutSummary;
}

function candidate(input: Omit<CandidateFinding, "url" | "pageType">, page: PageInput): CandidateFinding {
  return { ...input, url: page.url, pageType: page.pageType };
}

export async function evaluatePage(page: PageInput, analyzer: SemanticAnalyzer): Promise<CandidateFinding[]> {
  const findings: CandidateFinding[] = [];
  if (page.httpStatus !== undefined && page.httpStatus >= 400) return findings;
  const claimBearingPage = new Set<SentinelPageType>(["HOME", "PRODUCT", "COLLECTION", "CATEGORY", "LANDING", "BLOG", "ARTICLE"]).has(page.pageType);
  let materialConsumerClaim = false;
  for (const claim of claimBearingPage ? page.content.claims : []) {
    const analysis = await analyzer.analyze(claim);
    if (analysis.classification === "administration_instruction") {
      materialConsumerClaim = true;
      const severity = analysis.risk === "critical" && analysis.confidence >= 0.9 ? "CRITICAL" as const : "HIGH" as const;
      findings.push(candidate({ ruleKey: "RSRCH-ADMIN-001", severity, confidence: analysis.confidence, status: "NEEDS_REVIEW", category: "Claims & intended use", title: severity === "CRITICAL" ? "Explicit human administration instruction" : "Potential administration instruction", description: severity === "CRITICAL" ? "The page pairs an administration action with a dose, frequency or route." : "Language on the page may describe how a product is administered.", detectedText: analysis.evidenceSpan, reason: analysis.reason, recommendedAction: "Review the complete sentence and its product context; remove consumer administration guidance if it conflicts with the declared research-only model.", scoreComponent: "RESEARCH_CONTROLS" }, page));
    } else if (analysis.classification === "consumer_claim") {
      materialConsumerClaim = true;
      const medical = analysis.signalType === "MEDICAL_CLAIM"; const testimonial = analysis.signalType === "HUMAN_TESTIMONIAL" || analysis.signalType === "BEFORE_AFTER_OUTCOME";
      const severity = medical && analysis.confidence >= 0.9 ? "CRITICAL" as const : "HIGH" as const;
      findings.push(candidate({ ruleKey: medical ? "MKT-MEDICAL-001" : testimonial ? "MKT-TESTIMONIAL-001" : "MKT-CLAIM-001", severity, confidence: analysis.confidence, status: "NEEDS_REVIEW", category: medical ? "Medical claim" : testimonial ? "Human outcome evidence" : "Marketing claim", title: medical ? "Explicit medical or disease claim" : testimonial ? "Potential human outcome testimonial" : "Potential consumer-directed outcome claim", description: medical ? "The page directly associates a product-facing statement with treatment, prevention, diagnosis or cure of a health condition." : testimonial ? "The page presents a human outcome, transformation or first-person result." : "Language on the page presents or implies a consumer-oriented outcome.", detectedText: analysis.evidenceSpan, reason: analysis.reason, recommendedAction: "Review the exact statement, its product association, substantiation and consistency with the declared business model.", scoreComponent: "MARKETING_RISK" }, page));
    } else if (analysis.classification === "needs_review" && analysis.signalType === "PRESCRIPTION_SIGNAL") {
      findings.push(candidate({ ruleKey: "RX-REVIEW-001", severity: "MEDIUM", confidence: analysis.confidence, status: "NEEDS_REVIEW", category: "Business-model signal", title: "Prescription or pharmacy context requires review", description: "The page contains an explicit prescription, pharmacy or medical-service signal.", detectedText: analysis.evidenceSpan, reason: analysis.reason, recommendedAction: "Verify the business model and the role of this language. Do not infer a pharmacy operation from the keyword alone.", scoreComponent: "OPERATIONAL_CONSISTENCY" }, page));
    }
  }

  if (page.pageType === "PRODUCT" && hasProductEvidence(page.content) && page.content.prices.length === 0) {
    findings.push(candidate({ ruleKey: "PROD-PRICE-001", severity: "LOW", confidence: 0.77, status: "NEEDS_REVIEW", category: "Product integrity", title: "Product price was not detected", description: "The product page did not expose a recognizable price in its rendered content.", reason: "A price could not be extracted from the rendered product page.", recommendedAction: "Confirm that price and purchase terms are clear before a visitor commits to an order.", scoreComponent: "PRODUCT_INTEGRITY" }, page));
  }
  if (page.pageType === "PRODUCT" && page.content.disclaimers.length === 0 && materialConsumerClaim) {
    findings.push(candidate({ ruleKey: "PROD-DISC-001", severity: "MEDIUM", confidence: 0.8, status: "NEEDS_REVIEW", category: "Disclosure", title: "Claims appear without nearby qualifying language", description: "The product page contains analyzable claims but no recognizable disclosure or qualification.", reason: "Claims were extracted while no qualifying language was detected in visible content.", recommendedAction: "Review whether clear, prominent and context-appropriate qualifying language is needed.", scoreComponent: "PRODUCT_INTEGRITY" }, page));
  }
  if (page.content.controls.loginWall && page.pageType !== "ACCOUNT") {
    findings.push(candidate({ ruleKey: "SITE-ACCESS-001", severity: "LOW", confidence: 0.72, status: "NEEDS_REVIEW", category: "Site controls", title: "Content appears gated by authentication", description: "The rendered page exposed a password gate outside an account page.", reason: "A password input and access language were present.", recommendedAction: "Confirm that monitoring can access the public content customers rely on.", scoreComponent: "SITE_CONTROLS" }, page));
  }
  if (isReviewableCheckout(page)) {
    const checkboxes = page.content.forms.flatMap((form) => form.fields).filter((field) => field.type === "checkbox");
    const hasTermsAcknowledgement = checkboxes.some((field) => /terms|condition|acknowledg/i.test(`${field.name} ${field.label}`));
    const hasTermsPresentation = page.content.links.some((link) => /terms|conditions/i.test(`${link.text} ${link.href}`)) || /\bterms (?:of service|and conditions)\b/i.test(page.content.visibleText);
    if (!hasTermsAcknowledgement && !hasTermsPresentation) findings.push(candidate({ ruleKey: "CHECKOUT-TERMS-001", severity: "LOW", confidence: 0.72, status: "NEEDS_REVIEW", category: "Checkout control", title: "Terms presentation was not detected", description: "The publicly accessible checkout view did not expose recognizable terms presentation or acknowledgement.", reason: "No visible terms link, terms copy, or associated acknowledgement field was observed in this rendered step.", recommendedAction: "Review the checkout step manually and confirm that applicable terms are presented clearly before order submission.", scoreComponent: "SITE_CONTROLS" }, page));
  }
  return findings;
}

export function requiredPolicyTypes(pages: PageInput[]): PolicySignalType[] {
  const usablePages = pages.filter((page) => page.httpStatus === undefined || page.httpStatus < 400);
  const siteText = usablePages.map((page) => page.content.visibleText).join(" ");
  const commerceObserved = usablePages.some((page) => ["PRODUCT", "CART", "CHECKOUT"].includes(page.pageType) && hasProductEvidence(page.content));
  const explicitlyDigitalOrService = /\b(?:digital download|downloadable|software|saas|online course|consulting|consultation|professional services?|subscription software)\b/i.test(siteText);
  return ["PRIVACY", "TERMS", "CONTACT", ...(commerceObserved ? ["REFUND"] : []), ...(commerceObserved && !explicitlyDigitalOrService ? ["SHIPPING"] : [])] as PolicySignalType[];
}

export function evaluateSiteCoverage(pages: PageInput[], options: { coverageRatio?: number } = {}): CandidateFinding[] {
  if (!pages.length) return [];
  const home = pages.find((page) => page.pageType === "HOME") ?? pages[0];
  const usablePages = pages.filter((page) => page.httpStatus === undefined || page.httpStatus < 400);
  const present = new Set<PolicySignalType>(usablePages.flatMap((page) => detectPolicySignals(page.url, page.content, page.pageType)));
  const applicable = new Set(requiredPolicyTypes(usablePages));
  const required: Array<{ type: PolicySignalType; key: string; title: string; severity: "HIGH" | "MEDIUM" }> = [
    { type: "PRIVACY", key: "POLICY-PRIVACY-001", title: "Privacy policy not found", severity: "HIGH" },
    { type: "TERMS", key: "POLICY-TERMS-001", title: "Terms of service not found", severity: "MEDIUM" },
    { type: "CONTACT", key: "POLICY-CONTACT-001", title: "Public contact page not found", severity: "MEDIUM" },
    { type: "REFUND", key: "POLICY-REFUND-001", title: "Refund or cancellation policy not found", severity: "MEDIUM" },
    { type: "SHIPPING", key: "POLICY-SHIPPING-001", title: "Shipping policy not found", severity: "MEDIUM" },
  ];
  const coverageRatio = options.coverageRatio ?? 1;
  if (coverageRatio < 0.65) return [];
  const uncertainCoverage = coverageRatio < 0.85;
  return required.filter(({ type }) => applicable.has(type) && !present.has(type)).map(({ type, key, title, severity }) => candidate({ ruleKey: key, severity: uncertainCoverage && severity === "HIGH" ? "MEDIUM" : severity, confidence: uncertainCoverage ? 0.74 : 0.92, status: uncertainCoverage ? "NEEDS_REVIEW" : "OPEN", category: "Policy coverage", title, description: `A recognizable ${type.toLowerCase()} policy was not found in the successfully scanned pages.`, reason: uncertainCoverage ? "The policy signal was not observed, but crawl coverage was incomplete; absence is treated as uncertainty rather than a confirmed violation." : "No accessible page matched this coverage area by URL slug, page classification, heading or policy-language signals.", recommendedAction: "Confirm that the policy is public, accessible and linked from persistent site navigation.", scoreComponent: "POLICY_COVERAGE" }, home));
}
