import type { NormalizedContent, SentinelPageType } from "@/sentinel/types";

export const policySignalTypes = ["TERMS", "PRIVACY", "REFUND", "SHIPPING", "CONTACT", "RESEARCH_USE", "AGE", "PROMOTION"] as const;
export type PolicySignalType = (typeof policySignalTypes)[number];

type SignalRule = {
  type: PolicySignalType;
  path: RegExp;
  content: RegExp;
};

const rules: SignalRule[] = [
  {
    type: "PRIVACY",
    path: /(?:^|\/)(?:privacy(?:[-_/](?:policy|notice|statement))?|data[-_/](?:privacy|protection)|politica[-_/]de[-_/]privacidad)(?:[-_/]|$)/i,
    content: /\b(?:privacy policy|privacy notice|data protection|personal (?:data|information)|data controller|information we collect|how we use (?:your )?(?:data|information)|pol[ií]tica de privacidad)\b/i,
  },
  {
    type: "TERMS",
    path: /(?:^|\/)(?:terms(?:[-_/](?:of[-_/](?:service|use)|and[-_/]conditions|conditions))?|conditions[-_/]of[-_/]use|service[-_/]agreement|legal[-_/]terms)(?:[-_/]|$)/i,
    content: /\b(?:terms (?:of (?:service|use)|and conditions)|conditions of use|limitation of liability|governing law|user agreement|service agreement|t[eé]rminos y condiciones)\b/i,
  },
  {
    type: "REFUND",
    path: /(?:^|\/)(?:refunds?|returns?|returns?[-_/]and[-_/]refunds?|refund[-_/]and[-_/]return|cancellations?|replacement[-_/]policy)(?:[-_/]|$)/i,
    content: /\b(?:refund policy|return policy|returns? and refunds?|refund eligibility|eligible for (?:a )?refund|return window|cancellation (?:policy|conditions?|window)|non[- ]refundable|pol[ií]tica de (?:devoluciones|reembolso))\b/i,
  },
  {
    type: "SHIPPING",
    path: /(?:^|\/)(?:shipping|delivery|shipping[-_/]and[-_/]delivery|shipping[-_/]policy|delivery[-_/]information|fulfillment|envios?)(?:[-_/]|$)/i,
    content: /\b(?:shipping policy|shipping rates?|shipping methods?|delivery (?:time|times|window|information)|estimated delivery|order fulfillment|dispatch time|pol[ií]tica de env[ií]os)\b/i,
  },
  {
    type: "CONTACT",
    path: /(?:^|\/)(?:contact(?:[-_/]us)?|support|support[-_/]center|customer[-_/]service|help[-_/]center|get[-_/]in[-_/]touch)(?:[-_/]|$)/i,
    content: /\b(?:contact us|get in touch|customer (?:service|support)|support (?:team|center)|send us (?:a )?message|contact information|cont[aá]ctanos)\b/i,
  },
  {
    type: "RESEARCH_USE",
    path: /(?:^|\/)(?:research[-_/]use(?:[-_/]only)?|research[-_/]disclaimer|laboratory[-_/]use|research[-_/]policy|analytical[-_/]use)(?:[-_/]|$)/i,
    content: /\b(?:research use only|for research purposes only|not for human (?:use|consumption)|laboratory (?:use|research|analysis)|analytical (?:use|reference)|research material|not intended for (?:human|clinical|diagnostic|therapeutic) use)\b/i,
  },
  {
    type: "AGE",
    path: /(?:^|\/)(?:age[-_/](?:policy|verification|requirement)|18[-_/]plus|21[-_/]plus)(?:[-_/]|$)/i,
    content: /\b(?:age (?:policy|verification|requirement)|must be (?:at least )?(?:18|21)|(?:18|21) years? of age|legal age)\b/i,
  },
  {
    type: "PROMOTION",
    path: /(?:^|\/)(?:promotion(?:al)?[-_/]terms|offer[-_/]terms|discount[-_/]terms)(?:[-_/]|$)/i,
    content: /\b(?:promotional terms|promotion terms|offer terms|discount conditions|promotion eligibility)\b/i,
  },
];

const pageTypePolicy: Partial<Record<SentinelPageType, PolicySignalType>> = {
  PRIVACY: "PRIVACY",
  TERMS: "TERMS",
  REFUND: "REFUND",
  SHIPPING: "SHIPPING",
  CONTACT: "CONTACT",
};

function pageText(content: Pick<NormalizedContent, "title" | "headings" | "visibleText">) {
  return `${content.title} ${content.headings.join(" ")} ${content.visibleText}`;
}

export function detectPolicySignals(
  url: string,
  content: Pick<NormalizedContent, "title" | "headings" | "visibleText">,
  pageType?: SentinelPageType,
): PolicySignalType[] {
  const path = new URL(url).pathname;
  const text = pageText(content);
  const detected = new Set<PolicySignalType>();
  const direct = pageType ? pageTypePolicy[pageType] : undefined;
  if (direct) detected.add(direct);
  for (const rule of rules) if (rule.path.test(path) || rule.content.test(text)) detected.add(rule.type);
  return [...detected];
}

export function complianceUrlPriority(input: string): number {
  let path = "";
  try { path = new URL(input).pathname; } catch { return 100; }
  const matchedIndex = rules.findIndex((rule) => rule.path.test(path));
  if (matchedIndex >= 0) return matchedIndex;
  if (/\/(?:polic(?:y|ies)|legal|help|faq)(?:[-_/]|$)/i.test(path)) return 20;
  if (/\/(?:products?|collections?|categories?|catalog)(?:[-_/]|$)/i.test(path)) return 60;
  return path === "/" ? 30 : 40;
}

