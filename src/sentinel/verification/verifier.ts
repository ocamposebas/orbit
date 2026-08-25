import type { Prisma } from "@/generated/prisma/client";
import { getDatabase } from "@/sentinel/db";
import type { EvidenceManifest, EvidenceManifestRecord } from "@/sentinel/evidence/schema";
import { VERIFIER_METHOD_VERSION, verifiedFactSchema, type VerifiedFact } from "./schema";

const policyPageTypes = ["POLICY", "TERMS", "PRIVACY", "REFUND", "SHIPPING", "CONTACT"] as const;
const legalPolicyPageTypes = ["POLICY", "TERMS", "PRIVACY", "REFUND", "SHIPPING"] as const;

function valueString(record: EvidenceManifestRecord) {
  return typeof record.value === "string" ? record.value : undefined;
}

function artifactGroups(records: EvidenceManifestRecord[]) {
  const grouped = new Map<string, EvidenceManifestRecord[]>();
  for (const record of records) grouped.set(record.artifactId, [...(grouped.get(record.artifactId) ?? []), record]);
  return [...grouped.values()];
}

function duplicateHash(record: EvidenceManifestRecord) {
  const metadata = record.artifactMetadata;
  return metadata && typeof metadata === "object" && "duplicateContentHash" in metadata && typeof metadata.duplicateContentHash === "string" ? metadata.duplicateContentHash : record.artifactHash;
}

function fact(input: VerifiedFact) {
  return verifiedFactSchema.parse(input);
}

export function verifyEvidenceManifest(manifest: EvidenceManifest): VerifiedFact[] {
  const firstParty = manifest.records.filter((record) => record.scope === "MERCHANT_SITE");
  const artifacts = artifactGroups(firstParty);
  const facts: VerifiedFact[] = [];

  for (const records of artifacts.filter((records) => records[0]?.artifactKind === "PAGE_SNAPSHOT")) {
    const representative = records[0];
    facts.push(fact({
      issueKey: `fact:url-status:${representative.sourceUrl}`,
      factType: "URL_STATUS",
      subjectId: representative.sourceUrl,
      state: representative.httpStatus === undefined ? "INCONCLUSIVE" : representative.httpStatus >= 200 && representative.httpStatus < 400 ? "VERIFIED" : "REFUTED",
      value: { url: representative.sourceUrl, httpStatus: representative.httpStatus ?? null },
      evidenceRecordIds: records.filter((record) => record.evidenceType === "PAGE_LOCATION" || record.evidenceType === "PAGE_TYPE").map((record) => record.id).slice(0, 4),
    }));
  }

  const pageTypeRecords = firstParty.filter((record) => record.evidenceType === "PAGE_TYPE");
  const productRecords = pageTypeRecords.filter((record) => valueString(record) === "PRODUCT");
  facts.push(fact({ issueKey: "fact:product-count", factType: "PRODUCT_COUNT", subjectId: manifest.scanId, state: "VERIFIED", value: { count: new Set(productRecords.map((record) => record.sourceUrl)).size }, evidenceRecordIds: (productRecords.length ? productRecords : pageTypeRecords).map((record) => record.id).slice(0, 100) }));

  for (const policyType of policyPageTypes) {
    const exact = pageTypeRecords.filter((record) => valueString(record) === policyType);
    const broad = policyType === "POLICY" ? pageTypeRecords.filter((record) => legalPolicyPageTypes.includes(valueString(record) as (typeof legalPolicyPageTypes)[number])) : exact;
    facts.push(fact({ issueKey: `fact:policy-presence:${policyType}`, factType: "POLICY_PRESENCE", subjectId: policyType, state: broad.length ? "VERIFIED" : "REFUTED", value: { policyType, present: broad.length > 0, urls: [...new Set(broad.map((record) => record.sourceUrl))] }, evidenceRecordIds: (broad.length ? broad : pageTypeRecords).map((record) => record.id).slice(0, 50) }));
  }

  const structured = firstParty.filter((record) => record.evidenceType === "STRUCTURED_DATA" || record.artifactKind === "STRUCTURED_DATA");
  facts.push(fact({ issueKey: "fact:structured-data-count", factType: "STRUCTURED_DATA_COUNT", subjectId: manifest.scanId, state: "VERIFIED", value: { count: structured.length }, evidenceRecordIds: (structured.length ? structured : pageTypeRecords).map((record) => record.id).slice(0, 100) }));

  const checkoutUrls = new Set(pageTypeRecords.filter((record) => valueString(record) === "CART" || valueString(record) === "CHECKOUT").map((record) => record.sourceUrl));
  const checkout = firstParty.filter((record) => record.artifactKind === "CHECKOUT_STATE" || (checkoutUrls.has(record.sourceUrl) && (record.evidenceType === "OBSERVED_CONTROLS" || record.evidenceType === "FORM_FIELD" || record.evidenceType === "INTERACTIVE_STATE")));
  facts.push(fact({ issueKey: "fact:checkout-controls", factType: "CHECKOUT_CONTROLS", subjectId: manifest.scanId, state: checkout.length ? "VERIFIED" : "INCONCLUSIVE", value: { observedRecordCount: checkout.length, urls: [...new Set(checkout.map((record) => record.sourceUrl))] }, evidenceRecordIds: checkout.map((record) => record.id).slice(0, 100) }));

  const documents = firstParty.filter((record) => record.evidenceType === "DOCUMENT_LINK" || record.artifactKind === "PDF" || record.artifactKind === "DOCUMENT_TEXT");
  facts.push(fact({ issueKey: "fact:document-availability", factType: "DOCUMENT_AVAILABILITY", subjectId: manifest.scanId, state: documents.length ? "VERIFIED" : "REFUTED", value: { count: new Set(documents.map((record) => record.artifactId)).size, urls: [...new Set(documents.map((record) => record.sourceUrl))] }, evidenceRecordIds: (documents.length ? documents : pageTypeRecords).map((record) => record.id).slice(0, 100) }));

  const pageArtifacts = artifacts.filter((records) => records[0]?.artifactKind === "PAGE_SNAPSHOT");
  const byHash = new Map<string, EvidenceManifestRecord[][]>();
  for (const records of pageArtifacts) {
    const hash = duplicateHash(records[0]);
    byHash.set(hash, [...(byHash.get(hash) ?? []), records]);
  }
  for (const [hash, groups] of byHash) {
    const urls = [...new Set(groups.map((records) => records[0].sourceUrl))];
    if (urls.length < 2) continue;
    facts.push(fact({ issueKey: `fact:exact-duplicate:${hash}`, factType: "EXACT_DUPLICATE_CONTENT", subjectId: hash, state: "VERIFIED", value: { hash, urls, count: urls.length }, evidenceRecordIds: groups.flatMap((records) => records.filter((record) => record.evidenceType === "PAGE_TYPE").map((record) => record.id)) }));
  }
  return facts;
}

export async function persistVerificationFacts(scanId: string, facts: VerifiedFact[]) {
  const db = getDatabase();
  const ids: string[] = [];
  for (const item of facts) {
    const assertion = await db.verificationAssertion.upsert({
      where: { scanId_issueKey_methodVersion: { scanId, issueKey: item.issueKey, methodVersion: VERIFIER_METHOD_VERSION } },
      update: { factType: item.factType, subjectId: item.subjectId, state: item.state, value: item.value as Prisma.InputJsonValue },
      create: { scanId, issueKey: item.issueKey, factType: item.factType, subjectId: item.subjectId, state: item.state, value: item.value as Prisma.InputJsonValue, methodVersion: VERIFIER_METHOD_VERSION },
    });
    await db.verificationEvidenceLink.deleteMany({ where: { verificationAssertionId: assertion.id } });
    if (item.evidenceRecordIds.length) await db.verificationEvidenceLink.createMany({ data: [...new Set(item.evidenceRecordIds)].map((evidenceRecordId) => ({ verificationAssertionId: assertion.id, evidenceRecordId })), skipDuplicates: true });
    ids.push(assertion.id);
  }
  return ids;
}
