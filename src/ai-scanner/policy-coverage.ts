export type PolicyEvidenceInput = {
  id?: string;
  toolName: string;
  kind: string;
  sourceUrl: string;
  destinationUrl?: string | null;
  exactText?: string | null;
  metadata?: unknown;
  surroundingDom?: unknown;
};

export type DerivedPolicyCoverage = {
  id: string;
  type: "TERMS" | "PRIVACY" | "REFUND" | "SHIPPING" | "CONTACT" | "RESEARCH_USE" | "AGE" | "PROMOTION";
  label: string;
  coverage: "FOUND" | "MISSING" | "NEEDS_REVIEW";
  url?: string;
  inspected: boolean;
};

const definitions: Array<{ type: DerivedPolicyCoverage["type"]; label: string; pattern: RegExp }> = [
  { type: "TERMS", label: "Terms", pattern: /(?:^|\/)(?:terms|terms-of-use|terms-of-service|terms-and-conditions|conditions)(?:[-_/]|$)/i },
  { type: "PRIVACY", label: "Privacy", pattern: /(?:^|\/)(?:privacy|data-protection|privacy-policy)(?:[-_/]|$)/i },
  { type: "REFUND", label: "Refund / returns", pattern: /(?:^|\/)(?:refund|refunds|return|returns|refund-and-return|return-policy)(?:[-_/]|$)/i },
  { type: "SHIPPING", label: "Shipping / delivery", pattern: /(?:^|\/)(?:shipping|delivery|shipping-policy)(?:[-_/]|$)/i },
  { type: "CONTACT", label: "Contact / support", pattern: /(?:^|\/)(?:contact|contact-us|support|help)(?:[-_/]|$)/i },
  { type: "RESEARCH_USE", label: "Research / acceptable use", pattern: /(?:^|\/)(?:research-use|acceptable-use|laboratory-use|usage-policy)(?:[-_/]|$)/i },
  { type: "AGE", label: "Age control", pattern: /(?:^|\/)(?:age|age-policy|age-verification)(?:[-_/]|$)/i },
  { type: "PROMOTION", label: "Promotion / advertising", pattern: /(?:^|\/)(?:promotion|promotions|advertising|marketing-policy)(?:[-_/]|$)/i },
];

export function collectEvidenceUrls(value: unknown, urls: Set<string>, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return;
  if (typeof value === "string") {
    for (const candidate of value.match(/https?:\/\/[^\s"'<>]+/gi) ?? []) {
      try { urls.add(new URL(candidate.replace(/[),.;]+$/, "")).toString()); } catch { /* not an absolute URL */ }
    }
    return;
  }
  if (Array.isArray(value)) return value.forEach((item) => collectEvidenceUrls(item, urls, depth + 1));
  if (typeof value === "object") Object.values(value as Record<string, unknown>).forEach((item) => collectEvidenceUrls(item, urls, depth + 1));
}

function matches(url: string, pattern: RegExp) {
  try { return pattern.test(new URL(url).pathname); } catch { return false; }
}

function metadataRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function deriveAiPolicyCoverage(evidence: readonly PolicyEvidenceInput[], scanComplete: boolean): DerivedPolicyCoverage[] {
  const urls = new Set<string>();
  for (const item of evidence) {
    collectEvidenceUrls(item.sourceUrl, urls);
    collectEvidenceUrls(item.destinationUrl, urls);
    collectEvidenceUrls(item.metadata, urls);
    collectEvidenceUrls(item.surroundingDom, urls);
  }

  return definitions.map((definition) => {
    const explicitInspection = evidence.find((item) => {
      const metadata = metadataRecord(item.metadata);
      return item.toolName === "inspect_policy"
        && metadata.policyType === definition.type
        && metadata.substantive === true;
    });
    const directContact = definition.type === "CONTACT" ? evidence.find((item) => item.toolName === "inspect_footer" && (/(?:mailto|tel):/i.test(JSON.stringify(item.surroundingDom ?? {})) || /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/.test(item.exactText ?? ""))) : undefined;
    const url = explicitInspection?.sourceUrl ?? [...urls].find((candidate) => matches(candidate, definition.pattern));
    const inspected = Boolean(explicitInspection) || Boolean(url && evidence.some((item) => {
      const substantiveText = (item.exactText ?? "").replace(/\s+/g, " ").trim().length >= 80;
      return matches(item.sourceUrl, definition.pattern)
        && substantiveText
        && ["inspect_policy", "get_page_snapshot", "get_visible_text", "get_dom"].includes(item.toolName);
    }));
    const ageGate = definition.type === "AGE" ? evidence.find((item) => item.toolName === "dismiss_public_access_gate") : undefined;
    const observedUrl = url ?? ageGate?.sourceUrl ?? directContact?.sourceUrl;
    return {
      id: `ai-scanner-v1-policy-${definition.type.toLowerCase()}`,
      type: definition.type,
      label: definition.label,
      coverage: inspected || Boolean(ageGate) || Boolean(directContact) ? "FOUND" as const : observedUrl || !scanComplete ? "NEEDS_REVIEW" as const : "MISSING" as const,
      ...(observedUrl ? { url: observedUrl } : {}),
      inspected: inspected || Boolean(ageGate) || Boolean(directContact),
    };
  });
}
