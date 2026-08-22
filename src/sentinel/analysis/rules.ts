import type { CandidateFinding, NormalizedContent, SentinelPageType } from "@/sentinel/types";
import type { SemanticAnalyzer } from "./semantic";
import { detectPolicySignals, type PolicySignalType } from "@/sentinel/classification/policy-signals";

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
  let decodedPath = new URL(page.url).pathname;
  try { decodedPath = decodeURIComponent(decodedPath); } catch { /* retain the encoded path */ }
  decodedPath = decodedPath.replace(/[-_/]+/g, " ");
  const humanDirectedPath = decodedPath.match(/\b(?:for human use|weight loss|fat loss|how to use|dosage|dosing|serving size|oral use|injectable|injection)\b/i)?.[0];
  if (humanDirectedPath) findings.push(candidate({ ruleKey: "MKT-SLUG-001", severity: "MEDIUM", confidence: 0.78, status: "NEEDS_REVIEW", category: "Navigation language", title: "Consumer-oriented URL requires context review", description: "The public URL contains language associated with a consumer outcome or administration path.", detectedText: humanDirectedPath, reason: "A URL slug is a secondary positioning signal, not proof of the page's intended use by itself.", recommendedAction: "Review the URL together with the product identity, visible content and research-use controls; rename it only if the combined evidence is inconsistent.", scoreComponent: "RESEARCH_CONTROLS" }, page));
  for (const claim of page.content.claims) {
    const analysis = await analyzer.analyze(claim);
    if (analysis.classification === "administration_instruction") {
      const severity = analysis.risk === "critical" && analysis.confidence >= 0.9 ? "CRITICAL" as const : "HIGH" as const;
      findings.push(candidate({ ruleKey: "RSRCH-ADMIN-001", severity, confidence: analysis.confidence, status: "NEEDS_REVIEW", category: "Claims & intended use", title: severity === "CRITICAL" ? "Explicit human administration instruction" : "Potential administration instruction", description: severity === "CRITICAL" ? "The page pairs an administration action with a dose, frequency or route." : "Language on the page may describe how a product is administered.", detectedText: analysis.evidenceSpan, reason: analysis.reason, recommendedAction: "Review the complete sentence and its product context; remove consumer administration guidance if it conflicts with the declared research-only model.", scoreComponent: "RESEARCH_CONTROLS" }, page));
    } else if (analysis.classification === "consumer_claim") {
      const medical = analysis.signalType === "MEDICAL_CLAIM"; const testimonial = analysis.signalType === "HUMAN_TESTIMONIAL" || analysis.signalType === "BEFORE_AFTER_OUTCOME";
      const severity = medical && analysis.confidence >= 0.9 ? "CRITICAL" as const : "HIGH" as const;
      findings.push(candidate({ ruleKey: medical ? "MKT-MEDICAL-001" : testimonial ? "MKT-TESTIMONIAL-001" : "MKT-CLAIM-001", severity, confidence: analysis.confidence, status: "NEEDS_REVIEW", category: medical ? "Medical claim" : testimonial ? "Human outcome evidence" : "Marketing claim", title: medical ? "Explicit medical or disease claim" : testimonial ? "Potential human outcome testimonial" : "Potential consumer-directed outcome claim", description: medical ? "The page directly associates a product-facing statement with treatment, prevention, diagnosis or cure of a health condition." : testimonial ? "The page presents a human outcome, transformation or first-person result." : "Language on the page presents or implies a consumer-oriented outcome.", detectedText: analysis.evidenceSpan, reason: analysis.reason, recommendedAction: "Review the exact statement, its product association, substantiation and consistency with the declared business model.", scoreComponent: "MARKETING_RISK" }, page));
    } else if (analysis.classification === "needs_review" && analysis.signalType === "PRESCRIPTION_SIGNAL") {
      findings.push(candidate({ ruleKey: "RX-REVIEW-001", severity: "MEDIUM", confidence: analysis.confidence, status: "NEEDS_REVIEW", category: "Business-model signal", title: "Prescription or pharmacy context requires review", description: "The page contains an explicit prescription, pharmacy or medical-service signal.", detectedText: analysis.evidenceSpan, reason: analysis.reason, recommendedAction: "Verify the business model and the role of this language. Do not infer a pharmacy operation from the keyword alone.", scoreComponent: "OPERATIONAL_CONSISTENCY" }, page));
    }
  }

  if (page.pageType === "PRODUCT" && page.content.prices.length === 0) {
    findings.push(candidate({ ruleKey: "PROD-PRICE-001", severity: "LOW", confidence: 0.77, status: "NEEDS_REVIEW", category: "Product integrity", title: "Product price was not detected", description: "The product page did not expose a recognizable price in its rendered content.", reason: "A price could not be extracted from the rendered product page.", recommendedAction: "Confirm that price and purchase terms are clear before a visitor commits to an order.", scoreComponent: "PRODUCT_INTEGRITY" }, page));
  }
  if (page.pageType === "PRODUCT" && page.content.disclaimers.length === 0 && page.content.claims.length > 0) {
    findings.push(candidate({ ruleKey: "PROD-DISC-001", severity: "MEDIUM", confidence: 0.8, status: "NEEDS_REVIEW", category: "Disclosure", title: "Claims appear without nearby qualifying language", description: "The product page contains analyzable claims but no recognizable disclosure or qualification.", reason: "Claims were extracted while no qualifying language was detected in visible content.", recommendedAction: "Review whether clear, prominent and context-appropriate qualifying language is needed.", scoreComponent: "PRODUCT_INTEGRITY" }, page));
  }
  if (page.content.controls.loginWall && page.pageType !== "ACCOUNT") {
    findings.push(candidate({ ruleKey: "SITE-ACCESS-001", severity: "LOW", confidence: 0.72, status: "NEEDS_REVIEW", category: "Site controls", title: "Content appears gated by authentication", description: "The rendered page exposed a password gate outside an account page.", reason: "A password input and access language were present.", recommendedAction: "Confirm that monitoring can access the public content customers rely on.", scoreComponent: "SITE_CONTROLS" }, page));
  }
  if (isReviewableCheckout(page)) {
    const checkboxes = page.content.forms.flatMap((form) => form.fields).filter((field) => field.type === "checkbox");
    const hasTermsAcknowledgement = checkboxes.some((field) => /terms|condition|acknowledg/i.test(`${field.name} ${field.label}`));
    if (!hasTermsAcknowledgement) findings.push(candidate({ ruleKey: "CHECKOUT-TERMS-001", severity: "MEDIUM", confidence: 0.78, status: "NEEDS_REVIEW", category: "Checkout control", title: "Terms acknowledgement was not detected", description: "The publicly accessible checkout view did not expose a recognizable terms acknowledgement control.", reason: "No checkbox field was associated with terms or acknowledgement language.", recommendedAction: "Review the checkout step manually and confirm that applicable terms are presented clearly before order submission.", scoreComponent: "SITE_CONTROLS" }, page));
  }
  return findings;
}

export function evaluateSiteCoverage(pages: PageInput[]): CandidateFinding[] {
  if (!pages.length) return [];
  const home = pages.find((page) => page.pageType === "HOME") ?? pages[0];
  const usablePages = pages.filter((page) => page.httpStatus === undefined || page.httpStatus < 400);
  const present = new Set<PolicySignalType>(usablePages.flatMap((page) => detectPolicySignals(page.url, page.content, page.pageType)));
  const required: Array<{ type: PolicySignalType; key: string; title: string; severity: "HIGH" | "MEDIUM" }> = [
    { type: "PRIVACY", key: "POLICY-PRIVACY-001", title: "Privacy policy not found", severity: "HIGH" },
    { type: "TERMS", key: "POLICY-TERMS-001", title: "Terms of service not found", severity: "MEDIUM" },
    { type: "REFUND", key: "POLICY-REFUND-001", title: "Refund or cancellation policy not found", severity: "MEDIUM" },
    { type: "SHIPPING", key: "POLICY-SHIPPING-001", title: "Shipping policy not found", severity: "MEDIUM" },
    { type: "CONTACT", key: "POLICY-CONTACT-001", title: "Public contact page not found", severity: "MEDIUM" },
  ];
  return required.filter(({ type }) => !present.has(type)).map(({ type, key, title, severity }) => candidate({ ruleKey: key, severity, confidence: 0.92, status: "OPEN", category: "Policy coverage", title, description: `A recognizable ${type.toLowerCase()} policy was not found in the successfully scanned pages.`, reason: "No accessible page matched this coverage area by URL slug, page classification, heading or policy-language signals.", recommendedAction: "Confirm that the policy is public, accessible and linked from persistent site navigation.", scoreComponent: "POLICY_COVERAGE" }, home));
}
