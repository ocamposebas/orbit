import type { CandidateFinding, NormalizedContent, SentinelPageType } from "@/sentinel/types";
import type { SemanticAnalyzer } from "./semantic";

interface PageInput { url: string; pageType: SentinelPageType; content: NormalizedContent }

function candidate(input: Omit<CandidateFinding, "url" | "pageType">, page: PageInput): CandidateFinding {
  return { ...input, url: page.url, pageType: page.pageType };
}

export async function evaluatePage(page: PageInput, analyzer: SemanticAnalyzer): Promise<CandidateFinding[]> {
  const findings: CandidateFinding[] = [];
  for (const claim of page.content.claims) {
    const analysis = await analyzer.analyze(claim);
    if (analysis.classification === "administration_instruction") {
      findings.push(candidate({ ruleKey: "RSRCH-ADMIN-001", severity: "HIGH", confidence: analysis.confidence, status: "NEEDS_REVIEW", category: "Product language", title: "Potential administration instruction", description: "Language on the page may describe how a product is administered.", detectedText: analysis.evidenceSpan, reason: analysis.reason, recommendedAction: "Review the statement in context and remove consumer administration guidance where it conflicts with the declared business model.", scoreComponent: "RESEARCH_CONTROLS" }, page));
    } else if (analysis.classification === "consumer_claim") {
      findings.push(candidate({ ruleKey: "MKT-CLAIM-001", severity: "HIGH", confidence: analysis.confidence, status: "NEEDS_REVIEW", category: "Marketing claim", title: "Potential consumer-directed efficacy claim", description: "Language on the page may promise or imply a consumer outcome.", detectedText: analysis.evidenceSpan, reason: analysis.reason, recommendedAction: "Review the claim, its substantiation and its fit with the declared business model.", scoreComponent: "MARKETING_RISK" }, page));
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
  if (page.pageType === "CHECKOUT") {
    const checkboxes = page.content.forms.flatMap((form) => form.fields).filter((field) => field.type === "checkbox");
    const hasTermsAcknowledgement = checkboxes.some((field) => /terms|condition|acknowledge/i.test(field.name));
    if (!hasTermsAcknowledgement) findings.push(candidate({ ruleKey: "CHECKOUT-TERMS-001", severity: "MEDIUM", confidence: 0.78, status: "NEEDS_REVIEW", category: "Checkout control", title: "Terms acknowledgement was not detected", description: "The publicly accessible checkout view did not expose a recognizable terms acknowledgement control.", reason: "No checkbox field was associated with terms or acknowledgement language.", recommendedAction: "Review the checkout step manually and confirm that applicable terms are presented clearly before order submission.", scoreComponent: "SITE_CONTROLS" }, page));
  }
  return findings;
}

export function evaluateSiteCoverage(pages: PageInput[]): CandidateFinding[] {
  if (!pages.length) return [];
  const home = pages.find((page) => page.pageType === "HOME") ?? pages[0];
  const present = new Set(pages.map((page) => page.pageType));
  const required: Array<{ type: SentinelPageType; key: string; title: string; severity: "HIGH" | "MEDIUM" }> = [
    { type: "PRIVACY", key: "POLICY-PRIVACY-001", title: "Privacy policy not found", severity: "HIGH" },
    { type: "TERMS", key: "POLICY-TERMS-001", title: "Terms of service not found", severity: "MEDIUM" },
    { type: "REFUND", key: "POLICY-REFUND-001", title: "Refund or cancellation policy not found", severity: "MEDIUM" },
    { type: "SHIPPING", key: "POLICY-SHIPPING-001", title: "Shipping policy not found", severity: "MEDIUM" },
    { type: "CONTACT", key: "POLICY-CONTACT-001", title: "Public contact page not found", severity: "MEDIUM" },
  ];
  return required.filter(({ type }) => !present.has(type)).map(({ type, key, title, severity }) => candidate({ ruleKey: key, severity, confidence: 0.9, status: "OPEN", category: "Policy coverage", title, description: `A recognizable ${type.toLowerCase()} page was not found during this scan.`, reason: "No discovered page met the classifier threshold for this coverage area.", recommendedAction: "Publish a clear, accessible policy and link it from persistent site navigation.", scoreComponent: "POLICY_COVERAGE" }, home));
}
