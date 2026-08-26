import type { Prisma } from "@/generated/prisma/client";
import { getDatabase } from "@/sentinel/db";
import { normalizePublicUrl } from "@/sentinel/security/ssrf";
import type { LunaAuditResult, LunaFinding } from "./types";

const imageKinds = new Set(["SCREENSHOT", "VISUAL_REGION", "IMAGE", "BACKGROUND_IMAGE", "CAROUSEL"]);
const json = (value: unknown) => value as Prisma.InputJsonValue;

function referencedIds(finding: LunaFinding) {
  return [...finding.adverseEvidence, ...finding.mitigatingEvidence, ...finding.neutralEvidence].map((item) => item.evidenceId);
}

function sameObservedLocation(affectedUrl: string, evidence: { sourceUrl: string; destinationUrl: string | null }) {
  try {
    const affected = normalizePublicUrl(affectedUrl).toString();
    return affected === normalizePublicUrl(evidence.sourceUrl).toString()
      || (evidence.destinationUrl ? affected === normalizePublicUrl(evidence.destinationUrl).toString() : false);
  } catch { return false; }
}

export async function validateLunaAudit(scanId: string, audit: LunaAuditResult) {
  const allIds = new Set([
    ...audit.observations.flatMap((item) => item.evidenceIds),
    ...audit.findings.flatMap((item) => [...referencedIds(item), ...item.screenshotEvidenceIds]),
  ]);
  const evidence = await getDatabase().aiEvidence.findMany({
    where: { scanId, id: { in: [...allIds] } },
    select: { id: true, kind: true, sourceUrl: true, destinationUrl: true, exactText: true, metadata: true, firstParty: true, validated: true },
  });
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const warnings: string[] = [];

  const observations = audit.observations.filter((observation) => {
    const valid = observation.evidenceIds.length > 0 && observation.evidenceIds.every((id) => byId.get(id)?.firstParty && byId.get(id)?.validated);
    if (!valid) warnings.push(`Dropped an observation with a missing or unvalidated evidence reference: ${observation.text.slice(0, 120)}`);
    return valid;
  });

  const products = await getDatabase().aiProduct.findMany({ where: { scanId, verified: true }, select: { canonicalUrl: true, sku: true } });
  const findings: LunaFinding[] = [];
  for (const finding of audit.findings) {
    const ids = referencedIds(finding);
    const records = ids.map((id) => byId.get(id));
    if (!ids.length || records.some((item) => !item?.firstParty || !item.validated)) {
      warnings.push(`Dropped finding "${finding.title}" because it referenced missing or unvalidated first-party evidence.`);
      continue;
    }
    if (!records.some((item) => item && sameObservedLocation(finding.affectedUrl, item))) {
      warnings.push(`Dropped finding "${finding.title}" because no cited evidence observed its affected URL.`);
      continue;
    }
    if (finding.screenshotEvidenceIds.some((id) => !byId.has(id) || !imageKinds.has(byId.get(id)!.kind))) {
      warnings.push(`Dropped finding "${finding.title}" because a screenshot evidence ID did not reference retained pixels.`);
      continue;
    }
    let verifiedSku = finding.verifiedSku ?? null;
    const normalizedAffected = normalizePublicUrl(finding.affectedUrl).toString();
    const verifiedProduct = products.find((product) => normalizePublicUrl(product.canonicalUrl).toString() === normalizedAffected);
    if (verifiedSku) {
      const skuCandidate = verifiedSku;
      const productMatch = verifiedProduct?.sku === skuCandidate;
      const evidenceMatch = records.some((item) => item?.exactText?.includes(skuCandidate));
      if (!productMatch && !evidenceMatch) {
        warnings.push(`Removed an unverified SKU from finding "${finding.title}".`);
        verifiedSku = null;
      }
    }
    if (finding.productAssociation && !verifiedProduct) warnings.push(`Removed an unverified product association from finding "${finding.title}".`);
    findings.push({
      ...finding,
      productAssociation: finding.productAssociation && Boolean(verifiedProduct),
      verifiedSku,
      adverseEvidence: finding.adverseEvidence.map((item) => ({ evidenceId: item.evidenceId, rationale: item.rationale ?? undefined })),
      mitigatingEvidence: finding.mitigatingEvidence.map((item) => ({ evidenceId: item.evidenceId, rationale: item.rationale ?? undefined })),
      neutralEvidence: finding.neutralEvidence.map((item) => ({ evidenceId: item.evidenceId, rationale: item.rationale ?? undefined })),
    });
  }

  return { audit: { ...audit, observations, findings, limitations: [...audit.limitations, ...warnings] }, warnings };
}

export async function persistValidatedAudit(input: { scanId: string; organizationId: string; merchantId: string; audit: LunaAuditResult }) {
  const db = getDatabase();
  await db.aiFinding.deleteMany({ where: { scanId: input.scanId } });
  const created = [];
  for (const finding of input.audit.findings) {
    const links = [
      ...finding.adverseEvidence.map((reference) => ({ ...reference, role: "ADVERSE" as const })),
      ...finding.mitigatingEvidence.map((reference) => ({ ...reference, role: "MITIGATING" as const })),
      ...finding.neutralEvidence.map((reference) => ({ ...reference, role: "NEUTRAL" as const })),
    ];
    const record = await db.aiFinding.create({
      data: {
        scanId: input.scanId,
        organizationId: input.organizationId,
        merchantId: input.merchantId,
        title: finding.title,
        severity: finding.severity,
        confidence: finding.confidence,
        theme: finding.theme,
        category: finding.category,
        materiality: finding.materiality,
        materialityWeight: finding.materialityWeight,
        commercialProminence: finding.commercialProminence,
        visualProminence: finding.visualProminence,
        productAssociation: finding.productAssociation,
        mitigation: finding.mitigation,
        ambiguous: finding.ambiguous,
        contradictoryEvidence: finding.contradictoryEvidence,
        explanation: finding.explanation,
        affectedUrl: finding.affectedUrl,
        contentType: finding.contentType,
        affectedProduct: finding.affectedProduct,
        affectedCategory: finding.affectedCategory,
        verifiedSku: finding.verifiedSku,
        remediation: finding.remediation,
        evidence: { create: links.map((link) => ({ evidenceId: link.evidenceId, role: link.role, rationale: link.rationale })) },
      },
      include: { evidence: { include: { evidence: true } } },
    });
    created.push(record);
  }
  await db.aiScan.update({
    where: { id: input.scanId },
    data: { summary: input.audit.summary, observations: json(input.audit.observations), limitations: json(input.audit.limitations) },
  });
  return created;
}
