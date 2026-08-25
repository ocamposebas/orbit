import { analyzeContext } from "./contextual-signals";

export const evidenceClassifications = ["ADVERSE", "MITIGATING", "NEUTRAL", "INFORMATIONAL"] as const;
export type EvidenceClassification = (typeof evidenceClassifications)[number];

const technicalLaboratoryLanguage = /\b(?:HPLC|high[- ]performance liquid chromatography|mass spectrometry|LC[- /]?MS|certificate of analysis|COA|batch testing|lot testing|purity(?: testing| result)?|chromatograms?|analytical testing|laboratory testing|third[- ]party testing)\b/i;
const complianceLanguage = /\b(?:regulatory|compliance|FDA|Food and Drug Administration|legal disclaimer|label(?:ing)? requirements?|research[- ]only label(?:ing)?)\b/i;
const cautionLanguage = /\b(?:warn(?:s|ed|ing)?|caution(?:s|ed|ing)?|prohibit(?:s|ed|ing)?|discourage(?:s|d|ing)?|claims?\s+(?:lack|lacks|lacking)|insufficient evidence|unsupported claims?|unsubstantiated claims?|not supported by (?:medical |clinical |scientific )?evidence)\b/i;

export function classifyTextEvidence(input: string): EvidenceClassification {
  const text = input.replace(/\s+/g, " ").trim();
  if (!text) return "NEUTRAL";
  const context = analyzeContext(text);
  if (context.type === "RESEARCH_RESTRICTION") return "MITIGATING";
  if (context.type === "SCIENTIFIC_DISCUSSION") return cautionLanguage.test(text) ? "MITIGATING" : "INFORMATIONAL";
  if (context.material || context.type === "PRESCRIPTION_SIGNAL") return "ADVERSE";
  if (technicalLaboratoryLanguage.test(text) || complianceLanguage.test(text) || cautionLanguage.test(text)) return "INFORMATIONAL";
  return context.type === "NONE" ? "NEUTRAL" : "INFORMATIONAL";
}

const commercialEvidenceTypes = new Set(["TITLE", "META_DESCRIPTION", "HEADING", "NAVIGATION", "CATEGORY_COLLECTION", "PRODUCT_TITLE", "PRODUCT_DESCRIPTION", "CTA", "STRUCTURED_DATA", "IMAGE_ALT"]);
const standaloneQuestion = /^(?:can|could|should|would|what|which|who|when|where|why|how|is|are|do|does|did|may|might)\b[^.]{0,2000}\?$/i;

export function classifyEvidenceRecord(input: { text: string; evidenceType?: string; proposedClassification?: EvidenceClassification; sourceKind?: "TEXT" | "VISUAL" | "DOCUMENT" | "INTERACTIVE" }): EvidenceClassification {
  const textClassification = classifyTextEvidence(input.text);
  if (textClassification === "ADVERSE" || textClassification === "MITIGATING") return textClassification;
  if (standaloneQuestion.test(input.text.trim())) return "INFORMATIONAL";
  if (input.proposedClassification === "ADVERSE" && (input.sourceKind === "VISUAL" || input.sourceKind === "DOCUMENT")) return "ADVERSE";
  const theme = evidenceRiskTheme(input.text);
  const commercialMeaning = commercialEvidenceTypes.has(input.evidenceType ?? "") || /\b(?:applications?|benefits?|products?|collections?|categor(?:y|ies)|catalog|supports?|drives?|enhances?|promotes?)\b/i.test(input.text);
  if (input.proposedClassification === "ADVERSE" && theme !== "GENERAL" && commercialMeaning) return "ADVERSE";
  return textClassification;
}

export function isIndependentlyAdverse(input: string) {
  return classifyTextEvidence(input) === "ADVERSE";
}

export const evidenceRiskThemes = ["WEIGHT_METABOLIC", "MUSCLE_PERFORMANCE", "COGNITIVE_NEUROLOGICAL", "REPRODUCTIVE_FERTILITY", "RECOVERY_HEALING", "LONGEVITY_AGING", "MEDICAL_DISEASE", "DOSING_ADMINISTRATION", "PHARMACY_PRESCRIPTION", "COSMETIC", "GENERAL"] as const;
export type EvidenceRiskTheme = (typeof evidenceRiskThemes)[number];

export function evidenceRiskTheme(text: string): EvidenceRiskTheme {
  if (/\b(?:pharmacy|prescription|prescriber|telemedicine|medical provider|rx only)\b/i.test(text)) return "PHARMACY_PRESCRIPTION";
  if (/\b(?:dose|dosage|inject|injection|administer|administration|consume|ingest|swallow|subcutaneous|intramuscular)\w*\b/i.test(text)) return "DOSING_ADMINISTRATION";
  if (/\b(?:diagnos|treat|cure|prevent|disease|condition|disorder|cancer|diabetes|pain)\w*\b/i.test(text)) return "MEDICAL_DISEASE";
  if (/\b(?:cogniti\w*|memory|neuroprotect\w*|focus)\b/i.test(text)) return "COGNITIVE_NEUROLOGICAL";
  if (/\b(?:muscle|hypertroph\w*|human performance|bodybuild\w*)\b/i.test(text)) return "MUSCLE_PERFORMANCE";
  if (/\b(?:obesity|weight|appetite|adiposity|body[- ]?fat|metaboli\w*|fat[- ]?loss)\b/i.test(text)) return "WEIGHT_METABOLIC";
  if (/\b(?:reproductive|fertility|fertile)\b/i.test(text)) return "REPRODUCTIVE_FERTILITY";
  if (/\b(?:recovery|healing|injur\w*)\b/i.test(text)) return "RECOVERY_HEALING";
  if (/\b(?:longevity|anti[- ]?aging|lifespan)\b/i.test(text)) return "LONGEVITY_AGING";
  if (/\b(?:cosmetic|skin|beauty|topical)\b/i.test(text)) return "COSMETIC";
  return "GENERAL";
}

export function materiallyConflictingThemes(adverseText: string, mitigatingText: string) {
  const adverseTheme = evidenceRiskTheme(adverseText);
  const mitigatingTheme = evidenceRiskTheme(mitigatingText);
  if (adverseTheme === mitigatingTheme) return true;
  const broadHumanRestriction = /\b(?:research[- ]use only|research[- ]only|laboratory (?:research|use) only|not for human (?:use|consumption)|not intended to (?:diagnos|treat|cure|prevent)|strictly for (?:laboratory )?research)\b/i.test(mitigatingText);
  return broadHumanRestriction && adverseTheme !== "PHARMACY_PRESCRIPTION";
}
