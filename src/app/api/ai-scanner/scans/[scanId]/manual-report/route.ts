import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { extractManualImport, validateAiScanManualImport } from "@/ai-scanner/manual-report";
import type { AiEvidenceKind, Prisma } from "@/generated/prisma/client";
import { requestSession } from "@/sentinel/auth/session";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, merchantScope, validateMutationOrigin } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { evidenceStorage } from "@/sentinel/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function storageExtension(mimeType: string) {
  return mimeType === "application/pdf" ? "pdf" : mimeType === "application/json" ? "json" : "txt";
}

function evidenceKind(mimeType: string): AiEvidenceKind {
  return mimeType === "application/pdf" ? "PDF" : mimeType === "application/json" ? "STRUCTURED_DATA" : "VISIBLE_TEXT";
}

function evidenceDigest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function metadataRecord(value: Prisma.JsonValue) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function importedProductUrl(siteUrl: string, slug: string | undefined, sourceId: string | undefined, index: number) {
  try {
    const path = slug ? `/shop/${slug.replace(/^\/+|\/+$/g, "")}/` : `/imported-product/${encodeURIComponent(sourceId ?? String(index + 1))}`;
    return new URL(path, siteUrl).toString();
  } catch {
    return `${siteUrl.replace(/\/$/, "")}/imported-product/${encodeURIComponent(sourceId ?? String(index + 1))}`;
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  try {
    await enforceRateLimit(request, "ai-scanner-manual-report-upload", 10);
    const session = await requestSession(request);
    if (!session) throw new HttpError(401, "Authentication is required");
    if (!["OWNER", "ADMIN", "ANALYST"].includes(session.role)) throw new HttpError(403, "This role cannot import assessment documents");
    validateMutationOrigin(request);
    const { scanId } = await params;
    const db = getDatabase();
    const scan = await db.aiScan.findFirst({
      where: { id: scanId, merchant: merchantScope(session) },
      select: { id: true, merchantId: true, importedReportSha256: true, site: { select: { normalizedUrl: true } } },
    });
    if (!scan) throw new HttpError(404, "AI scan not found");

    const formData = await request.formData();
    const upload = await validateAiScanManualImport({ file: formData.get("report"), text: formData.get("content"), format: formData.get("format") });
    const { metrics, pages, fullText, analysis } = await extractManualImport(upload);
    const storageKey = `ai-scanner/${scanId}/imported-reports/${upload.sha256}.${storageExtension(upload.mimeType)}`;
    await evidenceStorage().put(storageKey, upload.bytes);
    const uploadedAt = new Date();
    const importEvidenceSha = evidenceDigest(`manual-import:${upload.sha256}`);
    const metadata = {
      imported: true,
      originalName: upload.originalName,
      rawSha256: upload.sha256,
      sizeBytes: upload.bytes.byteLength,
      documentType: upload.kind,
      pageCount: pages.length,
      characterCount: fullText.length,
      extraction: { textLayerPages: metrics.textLayerPageCount ?? 0, ocrPages: metrics.ocrPageCount ?? 0 },
      metrics,
      structuredCounts: { findings: analysis.findings.length, products: analysis.products.length, observations: analysis.observations.length, limitations: analysis.limitations.length },
      uploadedAt: uploadedAt.toISOString(),
    };
    const evidenceUnits = pages.map((page) => ({
      page,
      sha256: evidenceDigest(`manual-import:${upload.sha256}:unit:${page.pageNumber}:${page.text}`),
    }));

    let importEvidenceId = "";
    await db.$transaction(async (tx) => {
      const importedEvidence = await tx.aiEvidence.upsert({
        where: { scanId_sha256: { scanId, sha256: importEvidenceSha } },
        update: { storageKey, exactText: fullText, mimeType: upload.mimeType, metadata: metadata as unknown as Prisma.InputJsonValue, validated: true },
        create: {
          scanId,
          toolName: "import_manual_report",
          kind: evidenceKind(upload.mimeType),
          sourceUrl: scan.site.normalizedUrl,
          firstParty: true,
          exactText: fullText,
          storageKey,
          mimeType: upload.mimeType,
          sha256: importEvidenceSha,
          metadata: metadata as unknown as Prisma.InputJsonValue,
          validated: true,
        },
      });
      importEvidenceId = importedEvidence.id;

      if (evidenceUnits.length) await tx.aiEvidence.createMany({
        data: evidenceUnits.map(({ page, sha256 }) => ({
          scanId,
          toolName: "import_manual_report_content",
          kind: (upload.kind === "JSON" ? "STRUCTURED_DATA" : "VISIBLE_TEXT") as AiEvidenceKind,
          sourceUrl: scan.site.normalizedUrl,
          firstParty: true,
          exactText: page.text,
          mimeType: upload.kind === "JSON" ? "application/json" : "text/plain",
          sha256,
          metadata: {
            imported: true,
            parentEvidenceId: importedEvidence.id,
            originalName: upload.originalName,
            unitNumber: page.pageNumber,
            unitCount: pages.length,
            extraction: page.extraction,
          },
          validated: true,
        })),
        skipDuplicates: true,
      });

      const indexedEvidence = evidenceUnits.length ? await tx.aiEvidence.findMany({
        where: { scanId, sha256: { in: evidenceUnits.map((unit) => unit.sha256) } },
        select: { id: true, sha256: true },
      }) : [];
      const evidenceIdByPage = new Map(evidenceUnits.flatMap((unit) => {
        const evidence = indexedEvidence.find((candidate) => candidate.sha256 === unit.sha256);
        return evidence ? [[unit.page.pageNumber, evidence.id] as const] : [];
      }));

      // The source/history evidence remains immutable. Only the active scan's
      // derived dashboard entities are replaced by the newly selected import.
      await tx.aiFinding.deleteMany({ where: { scanId } });
      await tx.aiProduct.deleteMany({ where: { scanId } });

      for (const [index, finding] of analysis.findings.entries()) {
        const matchingProduct = analysis.products.find((product) => product.name.toLowerCase().includes((finding.affectedProduct ?? finding.title).toLowerCase()));
        const affectedUrl = matchingProduct ? importedProductUrl(scan.site.normalizedUrl, matchingProduct.slug, matchingProduct.sourceId, index) : scan.site.normalizedUrl;
        const created = await tx.aiFinding.create({
          data: {
            scanId,
            organizationId: session.organization.id,
            merchantId: scan.merchantId,
            title: finding.title,
            severity: finding.severity,
            confidence: 1,
            theme: "Imported report",
            category: finding.affectedCategory ?? "Imported assessment",
            materiality: ["CRITICAL", "HIGH"].includes(finding.severity) ? "MATERIAL" : "NON_MATERIAL",
            materialityWeight: finding.severity === "CRITICAL" ? 1 : finding.severity === "HIGH" ? 0.8 : finding.severity === "MEDIUM" ? 0.5 : 0.25,
            commercialProminence: 0.8,
            visualProminence: 0.6,
            productAssociation: Boolean(finding.affectedProduct),
            mitigation: 0,
            ambiguous: false,
            contradictoryEvidence: false,
            explanation: finding.explanation,
            affectedUrl,
            contentType: "IMPORTED_DOCUMENT",
            affectedProduct: finding.affectedProduct,
            affectedCategory: finding.affectedCategory,
            remediation: finding.remediation,
            status: "OPEN",
          },
          select: { id: true },
        });
        const evidenceId = evidenceIdByPage.get(finding.pageNumber) ?? importedEvidence.id;
        await tx.aiFindingEvidence.create({ data: { findingId: created.id, evidenceId, role: "ADVERSE", rationale: `Imported report page ${finding.pageNumber}` } });
      }

      if (analysis.products.length) await tx.aiProduct.createMany({
        data: analysis.products.map((product, index) => ({
          scanId,
          canonicalUrl: importedProductUrl(scan.site.normalizedUrl, product.slug, product.sourceId, index),
          name: product.name,
          sku: product.sku,
          price: product.price,
          currency: product.currency,
          variants: [],
          categories: product.category ? [product.category] : [],
          objectiveSignals: { imported: true, sourceId: product.sourceId, pageNumber: product.pageNumber },
          verified: true,
        })),
        skipDuplicates: true,
      });

      const observations = analysis.observations.map((observation) => ({ text: observation.text, evidenceIds: [evidenceIdByPage.get(observation.pageNumber) ?? importedEvidence.id] }));

      await tx.aiScan.update({
        where: { id: scanId },
        data: {
          status: "COMPLETED",
          failureCode: null,
          error: null,
          resumeAfter: null,
          completedAt: uploadedAt,
          summary: analysis.summary,
          score: metrics.healthScore ?? null,
          scoreBreakdown: analysis.scoreBreakdown as unknown as Prisma.InputJsonValue,
          coverage: { ...metrics.coverage, documentPages: pages.length, textLayerPages: metrics.textLayerPageCount ?? 0, ocrPages: metrics.ocrPageCount ?? 0 } as unknown as Prisma.InputJsonValue,
          observations: observations as unknown as Prisma.InputJsonValue,
          limitations: analysis.limitations as unknown as Prisma.InputJsonValue,
          importedReportStorageKey: storageKey,
          importedReportOriginalName: upload.originalName,
          importedReportMimeType: upload.mimeType,
          importedReportSizeBytes: upload.bytes.byteLength,
          importedReportSha256: upload.sha256,
          importedReportUploadedAt: uploadedAt,
          importedReportUploadedById: session.user.id,
          importedReportMetrics: metrics as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.merchant.update({ where: { id: scan.merchantId }, data: { status: analysis.findings.some((finding) => ["CRITICAL", "HIGH"].includes(finding.severity)) ? "REVIEW_REQUIRED" : "MONITORED" } });
      await tx.auditLog.create({
        data: {
          organizationId: session.organization.id,
          merchantId: scan.merchantId,
          aiScanId: scanId,
          actorId: session.user.id,
          action: "ai_scanner.document_imported",
          targetType: "AiEvidence",
          targetId: importedEvidence.id,
          metadata: {
            originalName: upload.originalName,
            mimeType: upload.mimeType,
            sizeBytes: upload.bytes.byteLength,
            sha256: upload.sha256,
            previousActiveSha256: scan.importedReportSha256,
            evidenceUnits: pages.length,
            characterCount: fullText.length,
            metrics,
            structuredCounts: metadata.structuredCounts,
          },
        },
      });
    });
    return NextResponse.json({
      importedReport: {
        id: importEvidenceId,
        originalName: upload.originalName,
        mimeType: upload.mimeType,
        sizeBytes: upload.bytes.byteLength,
        sha256: upload.sha256,
        uploadedAt,
        characterCount: fullText.length,
        metrics,
      },
    }, { status: 201 });
  } catch (error) { return apiError(error); }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ scanId: string }> }) {
  try {
    await enforceRateLimit(request, "ai-scanner-manual-report-download", 30);
    const session = await requestSession(request);
    if (!session) throw new HttpError(401, "Authentication is required");
    const { scanId } = await params;
    const evidenceId = request.nextUrl.searchParams.get("evidenceId");
    const db = getDatabase();

    let storageKey: string | null = null;
    let originalName: string | null = null;
    let mimeType: string | null = null;
    if (evidenceId) {
      const evidence = await db.aiEvidence.findFirst({
        where: { id: evidenceId, scanId, toolName: "import_manual_report", scan: { merchant: merchantScope(session) } },
        select: { storageKey: true, mimeType: true, metadata: true },
      });
      if (!evidence?.storageKey) throw new HttpError(404, "Imported document not found");
      const metadata = metadataRecord(evidence.metadata);
      storageKey = evidence.storageKey;
      mimeType = evidence.mimeType;
      originalName = typeof metadata.originalName === "string" ? metadata.originalName : null;
    } else {
      const scan = await db.aiScan.findFirst({
        where: { id: scanId, merchant: merchantScope(session) },
        select: { importedReportStorageKey: true, importedReportOriginalName: true, importedReportMimeType: true },
      });
      if (!scan?.importedReportStorageKey) throw new HttpError(404, "No document has been imported for this scan");
      storageKey = scan.importedReportStorageKey;
      originalName = scan.importedReportOriginalName;
      mimeType = scan.importedReportMimeType;
    }

    const bytes = await evidenceStorage().get(storageKey);
    if (!bytes) throw new HttpError(404, "The stored imported document could not be found");
    const contentType = mimeType ?? "application/octet-stream";
    const fallbackExtension = storageExtension(contentType);
    const name = (originalName ?? `orbit-ai-scan-${scanId.slice(-8)}-imported-document.${fallbackExtension}`).replace(/[\r\n"\\/]/g, "_");
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": contentType,
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) { return apiError(error); }
}
