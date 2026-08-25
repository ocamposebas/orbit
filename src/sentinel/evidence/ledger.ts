import type { Prisma } from "@/generated/prisma/client";
import { getDatabase } from "@/sentinel/db";
import { contentHash } from "@/sentinel/extraction/normalize";
import type { NormalizedContent, SentinelPageType } from "@/sentinel/types";
import { evidenceManifestSchema, type EvidenceManifest } from "./schema";

export const EVIDENCE_LEDGER_VERSION = "orbit-evidence-ledger-v1";

export interface PageEvidenceInput {
  snapshotId?: string;
  url: string;
  pageType: SentinelPageType;
  httpStatus?: number;
  content: NormalizedContent;
}

interface RecordInput {
  evidenceType: string;
  exactText?: string;
  value?: unknown;
  selector?: string;
  jsonPointer?: string;
  pageNumber?: number;
  coordinates?: unknown;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function recordHash(input: RecordInput) {
  return contentHash({ evidenceType: input.evidenceType, exactText: input.exactText, value: input.value, selector: input.selector, jsonPointer: input.jsonPointer, pageNumber: input.pageNumber, coordinates: input.coordinates });
}

function locatedRecords(evidenceType: string, values: Array<{ text: string; selector?: string }>): RecordInput[] {
  return values.filter((item) => item.text.trim()).map((item) => ({ evidenceType, exactText: item.text, selector: item.selector }));
}

function textChunks(text: string, maximum = 20_000) {
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += maximum) chunks.push(text.slice(offset, offset + maximum));
  return chunks;
}

function pageRecords(page: PageEvidenceInput): RecordInput[] {
  const { content } = page;
  const records: RecordInput[] = [
    { evidenceType: "PAGE_TYPE", value: page.pageType },
    ...textChunks(content.visibleText).map((exactText, index) => ({ evidenceType: "VISIBLE_TEXT_CHUNK", exactText, jsonPointer: `/visibleText/${index}` })),
    { evidenceType: "TITLE", exactText: content.title },
    { evidenceType: "META_TITLE", exactText: content.metadata.title },
    { evidenceType: "META_DESCRIPTION", exactText: content.metadata.description },
    { evidenceType: "OPEN_GRAPH_TITLE", exactText: content.metadata.openGraphTitle },
    { evidenceType: "OPEN_GRAPH_DESCRIPTION", exactText: content.metadata.openGraphDescription },
    { evidenceType: "PRODUCT_NAME", exactText: content.productName },
    { evidenceType: "PRODUCT_SHORT_DESCRIPTION", exactText: content.descriptions.short },
    { evidenceType: "PRODUCT_FULL_DESCRIPTION", exactText: content.descriptions.full },
    ...locatedRecords("HEADING", content.headingRecords.length ? content.headingRecords : content.headings.map((text) => ({ text }))),
    ...locatedRecords("NAVIGATION", content.navigation),
    ...locatedRecords("FOOTER", content.footer),
    ...locatedRecords("LINK_CTA", content.linkCtas),
    ...locatedRecords("BADGE", content.badges),
    ...locatedRecords("STOCK", content.stockText),
    ...locatedRecords("CHECKOUT_TEXT", content.checkoutText),
    ...content.claims.map((exactText) => ({ evidenceType: "CLAIM", exactText })),
    ...content.disclaimers.map((exactText) => ({ evidenceType: "DISCLAIMER", exactText })),
    ...content.prices.map((exactText) => ({ evidenceType: "PRICE", exactText })),
    ...content.breadcrumbs.map((exactText) => ({ evidenceType: "BREADCRUMB", exactText })),
    ...content.productCategories.map((exactText) => ({ evidenceType: "PRODUCT_CATEGORY", exactText })),
    ...content.productTags.map((exactText) => ({ evidenceType: "PRODUCT_TAG", exactText })),
    ...content.images.map((image, index) => ({ evidenceType: "IMAGE_REFERENCE", exactText: [image.alt, image.title].filter(Boolean).join(" | ") || undefined, value: image, jsonPointer: `/images/${index}` })),
    ...content.structuredData.map((value, index) => ({ evidenceType: "STRUCTURED_DATA", value, jsonPointer: `/structuredData/${index}` })),
    ...content.embeddedDocuments.map((document, index) => ({ evidenceType: "DOCUMENT_LINK", exactText: document.text || undefined, value: document, selector: document.selector, jsonPointer: `/embeddedDocuments/${index}` })),
    ...content.interactiveStates.map((state, index) => ({ evidenceType: "INTERACTIVE_STATE", exactText: state.label, value: state, selector: state.selector, jsonPointer: `/interactiveStates/${index}` })),
    ...content.forms.flatMap((form, formIndex) => form.fields.map((field, fieldIndex) => ({ evidenceType: "FORM_FIELD", exactText: field.label || undefined, value: { action: form.action, method: form.method, ...field }, jsonPointer: `/forms/${formIndex}/fields/${fieldIndex}` }))),
    { evidenceType: "OBSERVED_CONTROLS", value: content.controls, jsonPointer: "/controls" },
    { evidenceType: "PAGE_LOCATION", value: content.location, jsonPointer: "/location" },
  ];
  return records.filter((record) => Boolean(record.exactText?.trim()) || record.value !== undefined);
}

export async function persistPageEvidenceLedger(scanId: string, pages: PageEvidenceInput[]): Promise<EvidenceManifest> {
  const db = getDatabase();
  for (const page of pages) {
    const sha256 = contentHash(page.content);
    const duplicateContentHash = contentHash({ ...page.content, location: undefined });
    const artifact = await db.evidenceArtifact.upsert({
      where: { scanId_scope_kind_url_sha256: { scanId, scope: "MERCHANT_SITE", kind: "PAGE_SNAPSHOT", url: page.url, sha256 } },
      update: { httpStatus: page.httpStatus, metadata: jsonValue({ ledgerVersion: EVIDENCE_LEDGER_VERSION, snapshotId: page.snapshotId, pageType: page.pageType, duplicateContentHash }) },
      create: { scanId, scope: "MERCHANT_SITE", kind: "PAGE_SNAPSHOT", url: page.url, mimeType: "text/html", httpStatus: page.httpStatus, sha256, metadata: jsonValue({ ledgerVersion: EVIDENCE_LEDGER_VERSION, snapshotId: page.snapshotId, pageType: page.pageType, duplicateContentHash }) },
    });
    for (const record of pageRecords(page)) {
      const hash = recordHash(record);
      await db.evidenceRecord.upsert({
        where: { artifactId_evidenceType_contentHash: { artifactId: artifact.id, evidenceType: record.evidenceType, contentHash: hash } },
        update: { exactText: record.exactText, value: record.value === undefined ? undefined : jsonValue(record.value), selector: record.selector, jsonPointer: record.jsonPointer, pageNumber: record.pageNumber, coordinates: record.coordinates === undefined ? undefined : jsonValue(record.coordinates) },
        create: { artifactId: artifact.id, evidenceType: record.evidenceType, exactText: record.exactText, value: record.value === undefined ? undefined : jsonValue(record.value), selector: record.selector, jsonPointer: record.jsonPointer, pageNumber: record.pageNumber, coordinates: record.coordinates === undefined ? undefined : jsonValue(record.coordinates), contentHash: hash },
      });
    }
    if (page.pageType === "CART" || page.pageType === "CHECKOUT") {
      const checkoutValue = { pageType: page.pageType, controls: page.content.controls, forms: page.content.forms, checkoutText: page.content.checkoutText, interactiveStates: page.content.interactiveStates };
      await persistArtifactEvidence({ scanId, kind: "CHECKOUT_STATE", url: page.url, mimeType: "application/json", httpStatus: page.httpStatus, sha256: contentHash(checkoutValue), metadata: { explorationMode: "read_only", noFormSubmission: true, pageType: page.pageType }, records: [{ evidenceType: "CHECKOUT_STATE_SUMMARY", value: checkoutValue }] });
    }
  }
  return loadEvidenceManifest(scanId);
}

export async function loadEvidenceManifest(scanId: string): Promise<EvidenceManifest> {
  const artifacts = await getDatabase().evidenceArtifact.findMany({ where: { scanId }, include: { records: { orderBy: [{ evidenceType: "asc" }, { id: "asc" }] } }, orderBy: [{ scope: "asc" }, { kind: "asc" }, { url: "asc" }] });
  return evidenceManifestSchema.parse({
    version: "orbit-evidence-manifest-v1",
    scanId,
    generatedAt: new Date().toISOString(),
    records: artifacts.flatMap((artifact) => artifact.records.map((record) => ({
      id: record.id,
      artifactId: artifact.id,
      scope: artifact.scope,
      artifactKind: artifact.kind,
      sourceUrl: artifact.url,
      parentUrl: artifact.parentUrl ?? undefined,
      mimeType: artifact.mimeType ?? undefined,
      httpStatus: artifact.httpStatus ?? undefined,
      storageKey: artifact.storageKey ?? undefined,
      artifactMetadata: artifact.metadata,
      evidenceType: record.evidenceType,
      exactText: record.exactText ?? undefined,
      value: record.value ?? undefined,
      selector: record.selector ?? undefined,
      jsonPointer: record.jsonPointer ?? undefined,
      pageNumber: record.pageNumber ?? undefined,
      sourceHash: record.contentHash,
      artifactHash: artifact.sha256,
    }))),
  });
}

export async function persistArtifactEvidence(input: {
  scanId: string;
  scope?: "MERCHANT_SITE" | "EXTERNAL_PUBLIC_WEB";
  kind: "PAGE_SNAPSHOT" | "STRUCTURED_DATA" | "PUBLIC_API" | "IMAGE" | "SCREENSHOT" | "PDF" | "DOCUMENT_TEXT" | "CHECKOUT_STATE";
  url: string;
  parentUrl?: string;
  mimeType?: string;
  httpStatus?: number;
  storageKey?: string;
  sha256: string;
  metadata?: unknown;
  records: RecordInput[];
}) {
  const db = getDatabase();
  const scope = input.scope ?? "MERCHANT_SITE";
  const artifact = await db.evidenceArtifact.upsert({
    where: { scanId_scope_kind_url_sha256: { scanId: input.scanId, scope, kind: input.kind, url: input.url, sha256: input.sha256 } },
    update: { parentUrl: input.parentUrl, mimeType: input.mimeType, httpStatus: input.httpStatus, storageKey: input.storageKey, metadata: jsonValue(input.metadata ?? {}) },
    create: { scanId: input.scanId, scope, kind: input.kind, url: input.url, parentUrl: input.parentUrl, mimeType: input.mimeType, httpStatus: input.httpStatus, storageKey: input.storageKey, sha256: input.sha256, metadata: jsonValue(input.metadata ?? {}) },
  });
  for (const record of input.records) {
    const hash = recordHash(record);
    await db.evidenceRecord.upsert({
      where: { artifactId_evidenceType_contentHash: { artifactId: artifact.id, evidenceType: record.evidenceType, contentHash: hash } },
      update: { exactText: record.exactText, value: record.value === undefined ? undefined : jsonValue(record.value), selector: record.selector, jsonPointer: record.jsonPointer, pageNumber: record.pageNumber, coordinates: record.coordinates === undefined ? undefined : jsonValue(record.coordinates) },
      create: { artifactId: artifact.id, evidenceType: record.evidenceType, exactText: record.exactText, value: record.value === undefined ? undefined : jsonValue(record.value), selector: record.selector, jsonPointer: record.jsonPointer, pageNumber: record.pageNumber, coordinates: record.coordinates === undefined ? undefined : jsonValue(record.coordinates), contentHash: hash },
    });
  }
  return artifact;
}
