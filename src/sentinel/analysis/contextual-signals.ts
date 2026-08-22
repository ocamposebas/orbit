export const contextualSignalTypes = [
  "RESEARCH_RESTRICTION",
  "SCIENTIFIC_DISCUSSION",
  "HUMAN_ADMINISTRATION",
  "HUMAN_OUTCOME",
  "MEDICAL_CLAIM",
  "HUMAN_TESTIMONIAL",
  "BEFORE_AFTER_OUTCOME",
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
  /\b(?:research use only|for research purposes only|not for use in humans?|not for human (?:use|consumption))\b/i,
];

const scientificDiscussion = /\b(?:investigat(?:ed|ion)|stud(?:y|ied|ies)|evaluat(?:ed|ion)|observed|reported|examined|research(?:ers)?|literature|preclinical|in[ -]?vitro|in[ -]?vivo|animal model|rodent|receptor[- ]binding|assay|analytical reference|laboratory analysis)\b/i;
const directAdministration = /\b(?:inject|administer|take|consume|ingest|swallow|apply|use|reconstitute|mix)\b.{0,100}\b(?:\d+(?:\.\d+)?\s*(?:mcg|mg|g|ml|units?)|once|twice|daily|weekly|per day|per week|subcutaneous(?:ly)?|intramuscular(?:ly)?|before meals?|after meals?)\b/i;
const administrationInstruction = /\b(?:dosage|dosing protocol|recommended dose|serving size|injection protocol|cycle length|for subcutaneous injection|for intramuscular injection)\b/i;
const medicalClaim = /\b(?:treats?|cures?|heals?|prevents?|mitigates?|diagnoses?|reverses?|eliminates?)\b.{0,100}\b(?:diabetes|disease|injur(?:y|ies)|infection|cancer|obesity|anxiety|depression|pain|symptoms?|condition|disorder)\b/i;
const directOutcome = /\b(?:lose|loses|lost|promotes?|supports?|causes?|delivers?|boosts?|increases?|improves?|burns?|suppresses?|builds?)\b.{0,100}\b(?:weight|fat loss|metabolism|appetite|muscle|healing|energy|focus|sleep|body composition|anti[- ]aging|performance)\b/i;
const namedOutcome = /\b(?:rapid weight loss|fat loss|weight[- ]loss|muscle gain|body transformation|fat burner|healing blend|anti[- ]aging)\b/i;
const testimonial = /\b(?:i|my|we)\s+(?:lost|gained|felt|noticed|recovered|healed|improved)|\b(?:worked|results?)\s+(?:for me|in \d+ (?:days?|weeks?|months?))\b/i;
const beforeAfter = /\b(?:before\s*(?:&|and|\/)?\s*after|transformation|progress (?:photo|picture))\b.{0,120}\b(?:weight|body|skin|muscle|injury|healing|lbs?|pounds?)\b|\b(?:weight|body|skin|muscle|injury|healing|lbs?|pounds?)\b.{0,120}\b(?:before\s*(?:&|and|\/)?\s*after|transformation|progress (?:photo|picture))\b/i;
const prescriptionSignal = /\b(?:prescription|prescriber|pharmacy|telemedicine|medical consultation|prescription fulfillment|patient intake|rx only)\b/i;
const ambiguousHumanTerm = /\b(?:dose|dosage|injectable|injection|patient|therapy|treatment|weight loss|fat loss|healing|personal use|human use|consumption|bacteriostatic water|syringe|needle)\b/i;
const operationalPerformance = /\b(?:website|site|system|service|platform|account|checkout|application|business|operational)\s+(?:performance|functionality|availability|security|reliability)\b/i;

function result(input: Omit<ContextualSignal, "evidence">, evidence: string): ContextualSignal {
  return { ...input, evidence };
}

export function analyzeContext(input: string): ContextualSignal {
  const text = input.replace(/\s+/g, " ").trim();
  if (!text) return result({ type: "NONE", confidence: 1, material: false, consumerDirected: false, researchContext: false, rationale: "No text was available for contextual analysis." }, text);

  const restricted = researchRestriction.some((pattern) => pattern.test(text));
  const adversativeTail = text.match(/\b(?:but|however|yet|nevertheless)\b(.+)$/i)?.[1] ?? "";
  if (restricted && !(adversativeTail && (directAdministration.test(adversativeTail) || medicalClaim.test(adversativeTail) || directOutcome.test(adversativeTail)))) return result({ type: "RESEARCH_RESTRICTION", confidence: 0.98, material: false, consumerDirected: false, researchContext: true, rationale: "The sentence expressly prohibits human, personal or non-research use; the prohibited activity is not a consumer recommendation." }, text);
  if (operationalPerformance.test(text)) return result({ type: "NONE", confidence: 0.97, material: false, consumerDirected: false, researchContext: false, rationale: "The outcome term refers to website, platform or operational performance rather than a human result." }, text);

  const scientific = scientificDiscussion.test(text);
  const administration = directAdministration.test(text) || administrationInstruction.test(text);
  const medical = medicalClaim.test(text);
  const outcome = directOutcome.test(text) || namedOutcome.test(text);
  if (scientific && !administration && !/\b(?:you|your|take|inject|use this|recommended dose)\b/i.test(text)) return result({ type: "SCIENTIFIC_DISCUSSION", confidence: 0.92, material: false, consumerDirected: false, researchContext: true, rationale: "The wording describes scientific, preclinical or analytical context without a consumer instruction or promised outcome." }, text);
  if (testimonial.test(text) && outcome) return result({ type: "HUMAN_TESTIMONIAL", confidence: 0.95, material: true, consumerDirected: true, researchContext: false, rationale: "First-person outcome language presents a human experience or transformation." }, text);
  if (beforeAfter.test(text)) return result({ type: "BEFORE_AFTER_OUTCOME", confidence: 0.93, material: true, consumerDirected: true, researchContext: false, rationale: "Before/after language appears in proximity to a human body or health outcome." }, text);
  if (administration) return result({ type: "HUMAN_ADMINISTRATION", confidence: directAdministration.test(text) ? 0.97 : 0.9, material: true, consumerDirected: true, researchContext: scientific, rationale: directAdministration.test(text) ? "An administration action is paired with an amount, frequency or route of administration." : "The wording describes a dosage or administration protocol without an explicit research-use prohibition." }, text);
  if (medical) return result({ type: "MEDICAL_CLAIM", confidence: 0.96, material: true, consumerDirected: true, researchContext: false, rationale: "The wording directly associates treatment, prevention, diagnosis or cure language with a disease or health condition." }, text);
  if (outcome) return result({ type: "HUMAN_OUTCOME", confidence: directOutcome.test(text) ? 0.92 : 0.86, material: true, consumerDirected: true, researchContext: false, rationale: "The wording presents or names a consumer-oriented body, performance or wellbeing outcome." }, text);
  if (prescriptionSignal.test(text)) return result({ type: "PRESCRIPTION_SIGNAL", confidence: 0.84, material: false, consumerDirected: false, researchContext: false, rationale: "The wording contains a pharmacy, prescription or medical-service signal that requires contextual review." }, text);
  if (ambiguousHumanTerm.test(text)) return result({ type: "AMBIGUOUS", confidence: 0.45, material: false, consumerDirected: false, researchContext: scientific, rationale: "An isolated human-use keyword was found without enough context for a material finding." }, text);
  return result({ type: "NONE", confidence: 0.86, material: false, consumerDirected: false, researchContext: scientific, rationale: "No material consumer instruction, outcome, testimonial or medical claim was identified." }, text);
}
