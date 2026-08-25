export const contextualSignalTypes = [
  "RESEARCH_RESTRICTION",
  "SCIENTIFIC_DISCUSSION",
  "HUMAN_ADMINISTRATION",
  "HUMAN_OUTCOME",
  "MEDICAL_CLAIM",
  "HUMAN_TESTIMONIAL",
  "BEFORE_AFTER_OUTCOME",
  "COMMERCIAL_INTENDED_USE",
  "PRESCRIPTION_SIGNAL",
  "AMBIGUOUS",
  "NONE",
] as const;

export type ContextualSignalType = (typeof contextualSignalTypes)[number];

export interface ContextualSignal {
  type: ContextualSignalType;
  confidence: number;
  material: boolean;
  consumerDirected: boolean;
  researchContext: boolean;
  rationale: string;
  evidence: string;
}

const researchRestriction = [
  /\bno (?:content|statement|information|material|product claim)\b.{0,500}\b(?:medical advice|dosage guidance|treatment guidance|diagnostic guidance|health advice|non[- ]research use|consumer recommendation)\b/i,
  /\b(?:not|never)\s+(?:intended|designed|recommended|approved|represented|offered|sold|permitted)?\s*(?:to|for)?\s*(?:diagnos\w*|treat\w*|cure\w*|mitigat\w*|prevent\w*|administer\w*|inject\w*|consum\w*)\b/i,
  /\b(?:no|not|never|neither)\b.{0,180}\b(?:human (?:use|consumption|application)|consumption|injection|administration|personal use|patient use|medical use|therapeutic use|veterinary use|non[- ]research (?:use|purpose|application))\b/i,
  /\b(?:must|may|should|can|shall)\s+not\b.{0,140}\b(?:consume|ingest|inject|administer|use (?:in|on|for) humans?|human (?:use|consumption))\b/i,
  /\b(?:do not|don['’]t|prohibited|forbidden)\b.{0,140}\b(?:consume|ingest|inject|administer|human|patient|personal use)\b/i,
  /\b(?:solely|exclusively|strictly)\s+(?:intended )?for (?:laboratory |analytical )?research\b/i,
  /\b(?:research[- ]use only|research[- ]only(?: use)?|for research purposes only|laboratory (?:research|use) only|not for use in humans?|not for human (?:use|consumption))\b/i,
  /\b(?:clear )?label(?:ing)?\b.{0,100}\b(?:research[- ]use only|research[- ]only|laboratory (?:research|use) only)\b/i,
  /\b(?:regulatory|compliance) disclaimer\b|\bthis statement has not been evaluated by (?:the )?(?:FDA|Food and Drug Administration)\b/i,
];

const scientificDiscussion = /\b(?:investigat(?:ed|ion)|stud(?:y|ied|ies)|evaluat(?:ed|ion)|observed|reported|examined|research(?:ers)?|literature|preclinical|in[ -]?vitro|in[ -]?vivo|animal model|rodent|receptor[- ]binding|assay|analytical reference|laboratory analysis)\b/i;
const strongScientificContext = /\b(?:preclinical|in[ -]?vitro|in[ -]?vivo|animal model|rodent|receptor[- ]binding|assay|analytical reference|laboratory analysis)\b/i;
const directAdministration = /\b(?:inject|administer|take|consume|ingest|swallow|apply|use|reconstitute|mix)\b.{0,100}\b(?:\d+(?:\.\d+)?\s*(?:mcg|mg|g|ml|units?)|once|twice|daily|weekly|per day|per week|subcutaneous(?:ly)?|intramuscular(?:ly)?|before meals?|after meals?)\b/i;
const administrationInstruction = /\b(?:dosage|dosing protocol|recommended dose|serving size|injection protocol|cycle length|for subcutaneous injection|for intramuscular injection)\b/i;
const medicalClaim = /\b(?:treats?|cures?|heals?|prevents?|mitigates?|diagnoses?|reverses?|eliminates?)\b.{0,100}\b(?:diabetes|disease|injur(?:y|ies)|infection|cancer|obesity|anxiety|depression|pain|symptoms?|condition|disorder)\b/i;
const outcomeTerms = String.raw`(?:obesity|weight[- ]?loss|fat[- ]?loss|adiposity|body[- ]?fat|metaboli(?:sm|c(?: (?:outcomes?|health|function))?)|appetite(?: suppression| control)?|muscle (?:growth|gain|building)|hypertroph\w*|cognitive(?: (?:enhancement|performance|function))?|memory(?: enhancement)?|neuroprotect\w*|focus|reproductive(?: (?:health|function|outcomes?))?|fertility|recovery|healing|longevity|anti[- ]?aging|body composition|energy|sleep|human performance|performance)`;
const commercialTerms = String.raw`(?:research|products?|collections?|categor(?:y|ies)|catalog|compounds?|peptides?|blends?|formulas?|solutions?)`;
const directOutcome = new RegExp(String.raw`\b(?:lose|loses|lost|promotes?|supports?|causes?|delivers?|provides?|offers?|boosts?|increases?|improves?|burns?|suppresses?|builds?|enhances?|accelerates?|optimizes?)\b.{0,100}\b${outcomeTerms}\b`, "i");
const namedOutcome = new RegExp(String.raw`\b${outcomeTerms}\b`, "i");
const commercialIntendedUse = new RegExp(String.raw`(?:\b${outcomeTerms}\b.{0,60}\b${commercialTerms}\b|\b${commercialTerms}\b.{0,60}\b${outcomeTerms}\b)`, "i");
const testimonial = /\b(?:i|my|we)\s+(?:lost|gained|felt|noticed|recovered|healed|improved)|\b(?:worked|results?)\s+(?:for me|in \d+ (?:days?|weeks?|months?))\b/i;
const beforeAfter = /\b(?:before\s*(?:&|and|\/)?\s*after|transformation|progress (?:photo|picture))\b.{0,120}\b(?:weight|body|skin|muscle|injury|healing|lbs?|pounds?)\b|\b(?:weight|body|skin|muscle|injury|healing|lbs?|pounds?)\b.{0,120}\b(?:before\s*(?:&|and|\/)?\s*after|transformation|progress (?:photo|picture))\b/i;
const prescriptionSignal = /\b(?:prescription|prescriber|pharmacy|telemedicine|medical consultation|prescription fulfillment|patient intake|rx only)\b/i;
const ambiguousHumanTerm = new RegExp(String.raw`\b(?:dose|dosage|injectable|injection|patient|therapy|treatment|personal use|human use|consumption|bacteriostatic water|syringe|needle|${outcomeTerms})\b`, "i");
const operationalPerformance = /\b(?:website|site|system|service|platform|account|checkout|application|business|operational)\s+(?:performance|functionality|availability|security|reliability)\b/i;
const operationalContext = /\b(?:website|site|system|service|platform|account|checkout|application|analytics|traffic|fraud|abuse|troubleshoot(?:ing)?|customer behavior|technical|operational)\b/i;
const riskLanguage = /\b(?:medical|health|therapeutic|diagnostic|disease|treatment|cure|mitigation|prevention|dosage|dose|administration|inject(?:ion|ed)?|human|animal|personal wellness|bodybuilding|weight[- ]?loss|anti[- ]?aging|cosmetic|performance outcome|living organisms?|pharmacy|prescription|telemedicine|medical provider)\b/i;
const explicitDenial = [
  /\b(?:must|may|shall|should|can)\s+not\s+be\s+(?:used|administered|injected|ingested|consumed|applied|promoted)\b/i,
  /\b(?:does?|did|will)\s+not\s+(?:make|support|authorize|adopt|endorse|provide|claim|recommend|constitute|guarantee)\b/i,
  /\b(?:descriptions?|information|content|materials?|products?)\s+(?:do|does|are|is)\s+not\s+(?:constitute|provide|intended|approved|authorized|recommended|offered|sold)\b/i,
  /\bnothing\b.{0,160}\b(?:should|shall|may|can)?\s*(?:be\s+)?(?:interpreted|construed|understood|relied upon)\b/i,
  /\b(?:has|have|had)\s+not\s+been\s+(?:evaluated|approved|cleared|authorized|verified|validated)\b/i,
  /\b(?:not|never)\s+(?:for|intended for|approved for|authorized for)\b/i,
  /\b(?:we|this (?:company|business|site|website)|the (?:company|business|site|website))\s+(?:are|is)\s+not\s+(?:a|an)\s+(?:(?:compounding|retail)\s+)?(?:pharmacy|medical provider|telemedicine provider)\b/i,
];
const cautionOrCriticism = /(?:\b(?:marketed|promoted|advertised|claimed|positioned)\b.{0,220}\b(?:claims?\s+)?(?:lack|lacks|lacking|without|insufficient|unsupported|unsubstantiated|misleading|not supported|no sufficient)\b.{0,100}\b(?:evidence|support|substantiation|proof)\b|\b(?:claims?\s+)?(?:lack|lacks|lacking|insufficient|unsupported|unsubstantiated|misleading|not supported)\b.{0,180}\b(?:evidence|support|substantiation|proof|marketed|promoted|advertised|health benefits?|anti[- ]?aging|muscle (?:growth|building)|performance)\b|\b(?:warns?|warning|cautions?|criticizes?|prohibits?|discourages?)\b.{0,180}\b(?:claims?|marketing|promotion|human use|health benefits?|consumption|administration))/i;
const standaloneQuestion = /^(?:can|could|should|would|what|which|who|when|where|why|how|is|are|do|does|did|may|might)\b[^.]{0,500}\?$/i;

function result(input: Omit<ContextualSignal, "evidence">, evidence: string): ContextualSignal {
  return { ...input, evidence };
}

export function analyzeContext(input: string): ContextualSignal {
  const text = input.replace(/\s+/g, " ").trim();
  if (!text) return result({ type: "NONE", confidence: 1, material: false, consumerDirected: false, researchContext: false, rationale: "No text was available for contextual analysis." }, text);

  const restricted = researchRestriction.some((pattern) => pattern.test(text));
  const denial = riskLanguage.test(text) && explicitDenial.some((pattern) => pattern.test(text));
  const adversativeTail = text.match(/\b(?:but|however|yet|nevertheless|although|except)\b(.+)$/i)?.[1] ?? "";
  const materialTail = adversativeTail && (directAdministration.test(adversativeTail) || medicalClaim.test(adversativeTail) || directOutcome.test(adversativeTail) || commercialIntendedUse.test(adversativeTail));
  if ((restricted || denial) && !materialTail) return result({ type: "RESEARCH_RESTRICTION", confidence: 0.99, material: false, consumerDirected: false, researchContext: true, rationale: "The wording expressly denies, prohibits, or disclaims the risky use; terms inside that prohibition are not consumer recommendations." }, text);
  if (cautionOrCriticism.test(text) && !materialTail) return result({ type: "SCIENTIFIC_DISCUSSION", confidence: 0.97, material: false, consumerDirected: false, researchContext: true, rationale: "The wording criticizes, cautions against, or identifies insufficient evidence for promotional claims rather than making those claims." }, text);
  if (standaloneQuestion.test(text)) return result({ type: "AMBIGUOUS", confidence: 0.78, material: false, consumerDirected: false, researchContext: false, rationale: "A standalone question does not establish a promoted outcome; its answer and surrounding context must be reviewed together." }, text);
  if (operationalPerformance.test(text) || (operationalContext.test(text) && /\b(?:improv(?:e|es|ed|ing) performance|performance|behavior)\b/i.test(text))) return result({ type: "NONE", confidence: 0.98, material: false, consumerDirected: false, researchContext: false, rationale: "The wording describes website, analytics, fraud-prevention, or operational activity rather than a human outcome." }, text);

  const scientific = scientificDiscussion.test(text);
  const directAdministrationSignal = directAdministration.test(text);
  const administrationLabel = administrationInstruction.test(text);
  const medical = medicalClaim.test(text);
  const outcome = directOutcome.test(text) || namedOutcome.test(text);
  if (testimonial.test(text) && outcome) return result({ type: "HUMAN_TESTIMONIAL", confidence: 0.95, material: true, consumerDirected: true, researchContext: false, rationale: "First-person outcome language presents a human experience or transformation." }, text);
  if (beforeAfter.test(text)) return result({ type: "BEFORE_AFTER_OUTCOME", confidence: 0.93, material: true, consumerDirected: true, researchContext: false, rationale: "Before/after language appears in proximity to a human body or health outcome." }, text);
  if (directAdministrationSignal) return result({ type: "HUMAN_ADMINISTRATION", confidence: 0.97, material: true, consumerDirected: true, researchContext: scientific, rationale: "An administration action is paired with an amount, frequency or route of administration." }, text);
  if (administrationLabel) return result({ type: "AMBIGUOUS", confidence: 0.62, material: false, consumerDirected: false, researchContext: scientific, rationale: "A dosage or administration label was observed without a complete instruction, subject, amount, frequency, or route." }, text);
  if (medical) return result({ type: "MEDICAL_CLAIM", confidence: 0.96, material: true, consumerDirected: true, researchContext: false, rationale: "The wording directly associates treatment, prevention, diagnosis or cure language with a disease or health condition." }, text);
  if (directOutcome.test(text)) return result({ type: "HUMAN_OUTCOME", confidence: 0.92, material: true, consumerDirected: true, researchContext: false, rationale: "The wording presents a consumer-oriented body, performance or wellbeing outcome as an action or benefit." }, text);
  if (commercialIntendedUse.test(text) && !strongScientificContext.test(text)) return result({ type: "COMMERCIAL_INTENDED_USE", confidence: 0.9, material: true, consumerDirected: false, researchContext: false, rationale: "A physiological or therapeutic outcome appears in public product, category, collection, catalog, or research-positioning language; the word research does not neutralize that commercial intended-use signal." }, text);
  if (scientific && !directAdministrationSignal && !/\b(?:you|your|take|inject|use this|recommended dose)\b/i.test(text)) return result({ type: "SCIENTIFIC_DISCUSSION", confidence: 0.92, material: false, consumerDirected: false, researchContext: true, rationale: "The wording describes scientific, preclinical or analytical context without a consumer instruction, promised outcome, or commercial intended-use label." }, text);
  if (namedOutcome.test(text)) return result({ type: "AMBIGUOUS", confidence: 0.58, material: false, consumerDirected: false, researchContext: scientific, rationale: "An outcome phrase was named without a promise, instruction, testimonial, or clear product-facing assertion." }, text);
  if (prescriptionSignal.test(text)) return result({ type: "PRESCRIPTION_SIGNAL", confidence: 0.84, material: false, consumerDirected: false, researchContext: false, rationale: "The wording contains a pharmacy, prescription or medical-service signal that requires contextual review." }, text);
  if (ambiguousHumanTerm.test(text)) return result({ type: "AMBIGUOUS", confidence: 0.45, material: false, consumerDirected: false, researchContext: scientific, rationale: "An isolated human-use keyword was found without enough context for a material finding." }, text);
  return result({ type: "NONE", confidence: 0.86, material: false, consumerDirected: false, researchContext: scientific, rationale: "No material consumer instruction, outcome, testimonial or medical claim was identified." }, text);
}
