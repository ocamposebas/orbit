import type { Prisma } from "@/generated/prisma/client";
import { contentHash } from "@/sentinel/extraction/normalize";
import { normalizedContentSchema, type CandidateFinding, type SentinelPageType } from "@/sentinel/types";
import { evaluatePage, evaluateSiteCoverage } from "@/sentinel/analysis/rules";
import { CachedSemanticAnalyzer, LocalSemanticAnalyzer } from "@/sentinel/analysis/semantic";
import { evaluateContradictions } from "@/sentinel/analysis/contradictions";
import { findingsToResolve } from "@/sentinel/analysis/lifecycle";
import { calculateHealthScore } from "@/sentinel/analysis/score";
import { getDatabase } from "@/sentinel/db";
import { queues } from "@/sentinel/queue";
import { updateProgress } from "@/sentinel/services/progress";

const policyTypes: Partial<Record<SentinelPageType, "PRIVACY" | "TERMS" | "REFUND" | "SHIPPING" | "CONTACT">> = { PRIVACY: "PRIVACY", TERMS: "TERMS", REFUND: "REFUND", SHIPPING: "SHIPPING", CONTACT: "CONTACT" };

function inferredPolicyType(page: { pageType: SentinelPageType; content: { visibleText: string } }) {
  const direct = policyTypes[page.pageType]; if (direct) return direct;
  if (page.pageType !== "POLICY") return undefined;
  const text = page.content.visibleText.toLowerCase();
  if (/research use only|not for human/.test(text)) return "RESEARCH_USE" as const;
  if (/age (?:policy|requirement)|years? of age/.test(text)) return "AGE" as const;
  if (/promotion|discount|offer terms/.test(text)) return "PROMOTION" as const;
  if (/returns? policy/.test(text)) return "RETURNS" as const;
  if (/cancellation/.test(text)) return "CANCELLATION" as const;
  return "OTHER" as const;
}

export async function runAnalysisStage(scanId: string) {
  const db = getDatabase();
  const scan = await db.scan.findUniqueOrThrow({ where: { id: scanId }, include: { merchant: true, pages: { include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1 }, changes: { select: { id: true } } } } } });
  await db.scan.update({ where: { id: scanId }, data: { status: "ANALYZING" } });
  await updateProgress(scanId, { stage: "analyzing", message: "Evaluating page context and site coverage" });
  const pages = scan.pages.flatMap((page) => {
    const parsed = normalizedContentSchema.safeParse(page.normalizedContent);
    return parsed.success ? [{ id: page.id, snapshotId: page.snapshots[0]?.id, url: page.url, pageType: page.pageType as SentinelPageType, content: parsed.data }] : [];
  });
  const analyzer = new CachedSemanticAnalyzer(new LocalSemanticAnalyzer());
  const changedPageIds = new Set(scan.pages.filter((page) => page.changes.length > 0).map((page) => page.id));
  const pagesForDeepAnalysis = scan.mode === "INCREMENTAL" ? pages.filter((page) => changedPageIds.has(page.id)) : pages;
  const pageFindingGroups = await Promise.all(pagesForDeepAnalysis.map((page) => evaluatePage(page, analyzer)));
  const candidates = [...pageFindingGroups.flat(), ...evaluateSiteCoverage(pages), ...evaluateContradictions(pages)];
  const storedRuleVersions = await db.ruleVersion.findMany({ where: { version: 1, rule: { key: { in: [...new Set(candidates.map((candidate) => candidate.ruleKey))] } } }, include: { rule: { select: { key: true } } } });
  const ruleVersionByKey = new Map(storedRuleVersions.map((version) => [version.rule.key, version]));

  let productsDetected = 0; let policiesDetected = 0;
  for (const page of pages) {
    if (page.pageType === "PRODUCT" && page.content.productName) {
      const numericPrice = page.content.prices[0]?.replace(/[^\d.,]/g, "").replace(",", ".");
      const product = await db.product.upsert({ where: { merchantId_canonicalUrl: { merchantId: scan.merchantId, canonicalUrl: page.url } }, update: { name: page.content.productName, sku: page.content.sku, currentPrice: numericPrice && Number.isFinite(Number(numericPrice)) ? numericPrice : null, claims: page.content.claims, disclaimers: page.content.disclaimers, lastSeenAt: new Date() }, create: { merchantId: scan.merchantId, siteId: scan.siteId, canonicalUrl: page.url, name: page.content.productName, sku: page.content.sku, currentPrice: numericPrice && Number.isFinite(Number(numericPrice)) ? numericPrice : null, claims: page.content.claims, disclaimers: page.content.disclaimers } });
      const productSnapshotData = { data: page.content as unknown as Prisma.InputJsonValue, hash: contentHash(page.content) };
      const existingProductSnapshot = await db.productSnapshot.findFirst({ where: { productId: product.id, scanId }, select: { id: true } });
      if (existingProductSnapshot) await db.productSnapshot.update({ where: { id: existingProductSnapshot.id }, data: productSnapshotData });
      else await db.productSnapshot.create({ data: { productId: product.id, scanId, ...productSnapshotData } });
      await db.productVariant.deleteMany({ where: { productId: product.id } });
      if (page.content.variants.length) await db.productVariant.createMany({ data: page.content.variants.map((name) => ({ productId: product.id, name })) });
      productsDetected++;
    }
    const policyType = inferredPolicyType(page);
    if (policyType) {
      const policy = await db.policy.upsert({ where: { merchantId_siteId_type: { merchantId: scan.merchantId, siteId: scan.siteId, type: policyType } }, update: { coverage: "FOUND", url: page.url, currentHash: contentHash(page.content.visibleText), clauses: page.content.paragraphs }, create: { merchantId: scan.merchantId, siteId: scan.siteId, type: policyType, coverage: "FOUND", url: page.url, currentHash: contentHash(page.content.visibleText), clauses: page.content.paragraphs } });
      const policySnapshotData = { text: page.content.visibleText, textHash: contentHash(page.content.visibleText), coverage: "FOUND" as const, clauses: page.content.paragraphs };
      const existingPolicySnapshot = await db.policySnapshot.findFirst({ where: { policyId: policy.id, scanId }, select: { id: true } });
      if (existingPolicySnapshot) await db.policySnapshot.update({ where: { id: existingPolicySnapshot.id }, data: policySnapshotData });
      else await db.policySnapshot.create({ data: { policyId: policy.id, scanId, ...policySnapshotData } });
      policiesDetected++;
    }
  }
  const expectedPolicyTypes = ["TERMS", "PRIVACY", "REFUND", "SHIPPING", "CONTACT"] as const;
  const presentPolicyTypes = new Set(pages.map(inferredPolicyType).filter(Boolean));
  for (const type of expectedPolicyTypes) if (!presentPolicyTypes.has(type)) await db.policy.upsert({ where: { merchantId_siteId_type: { merchantId: scan.merchantId, siteId: scan.siteId, type } }, update: { coverage: "MISSING", url: null }, create: { merchantId: scan.merchantId, siteId: scan.siteId, type, coverage: "MISSING" } });

  const fingerprints = new Set<string>();
  const retainedForScore: CandidateFinding[] = [];
  if (scan.mode === "INCREMENTAL") {
    const changedUrls = new Set(pagesForDeepAnalysis.map((page) => page.url));
    const retained = await db.finding.findMany({ where: { merchantId: scan.merchantId, siteId: scan.siteId, status: { in: ["OPEN", "NEEDS_REVIEW", "CONFIRMED", "ACCEPTED_RISK"] }, url: { notIn: [...changedUrls] } } });
    for (const item of retained) {
      fingerprints.add(item.fingerprint);
      const category = item.category.toLowerCase();
      const scoreComponent = category.includes("policy") ? "POLICY_COVERAGE" : category.includes("marketing") ? "MARKETING_RISK" : category.includes("product") ? "PRODUCT_INTEGRITY" : category.includes("checkout") ? "SITE_CONTROLS" : category.includes("position") ? "OPERATIONAL_CONSISTENCY" : "RESEARCH_CONTROLS";
      retainedForScore.push({ ruleKey: item.fingerprint, severity: item.severity, confidence: item.confidence, status: "OPEN", category: item.category, title: item.title, description: item.description, url: item.url, pageType: item.pageType as SentinelPageType, detectedText: item.detectedText ?? undefined, reason: item.reason, recommendedAction: item.recommendedAction, scoreComponent });
    }
  }
  const evidenceJobs: string[] = [];
  let findingsCreated = 0;
  for (const candidate of candidates) {
    const ruleVersion = ruleVersionByKey.get(candidate.ruleKey);
    const fingerprint = contentHash(`${candidate.ruleKey}|${candidate.url}|${candidate.detectedText ?? candidate.title}`);
    fingerprints.add(fingerprint);
    const existing = await db.finding.findFirst({ where: { merchantId: scan.merchantId, fingerprint, status: { notIn: ["RESOLVED", "FALSE_POSITIVE", "IGNORED"] } }, orderBy: { firstDetectedAt: "asc" } });
    const finding = existing ? await db.finding.update({ where: { id: existing.id }, data: { scanId, ruleVersionId: ruleVersion?.id, severity: candidate.severity, confidence: candidate.confidence, status: candidate.status, lastDetectedAt: new Date(), description: candidate.description, reason: candidate.reason, recommendedAction: candidate.recommendedAction } }) : await db.finding.create({ data: { organizationId: scan.merchant.organizationId, merchantId: scan.merchantId, siteId: scan.siteId, scanId, ruleVersionId: ruleVersion?.id, severity: candidate.severity, confidence: candidate.confidence, status: candidate.status, category: candidate.category, title: candidate.title, description: candidate.description, url: candidate.url, pageType: candidate.pageType, detectedText: candidate.detectedText, reason: candidate.reason, recommendedAction: candidate.recommendedAction, fingerprint } });
    if (!existing) findingsCreated++;
    const sourcePage = pages.find((page) => page.url === candidate.url);
    const pageHash = sourcePage ? contentHash(sourcePage.content) : fingerprint;
    const evidenceData = { snapshotId: sourcePage?.snapshotId, pageUrl: candidate.url, normalizedText: candidate.detectedText, evidenceSnippet: candidate.detectedText, pageHash, ruleVersion: ruleVersion ? `${candidate.ruleKey}@${ruleVersion.version}` : undefined, modelVersion: analyzer.model, classificationConfidence: candidate.confidence, metadata: { ruleKey: candidate.ruleKey } };
    const existingEvidence = await db.findingEvidence.findFirst({ where: { findingId: finding.id, kind: "TEXT", pageHash, modelVersion: analyzer.model }, select: { id: true } });
    if (existingEvidence) await db.findingEvidence.update({ where: { id: existingEvidence.id }, data: evidenceData });
    else await db.findingEvidence.create({ data: { findingId: finding.id, kind: "TEXT", ...evidenceData } });
    if (candidate.severity === "HIGH" || candidate.severity === "CRITICAL") evidenceJobs.push(finding.id);
  }

  findingsCreated = await db.finding.count({ where: { scanId, firstDetectedAt: { gte: scan.startedAt ?? scan.createdAt } } });

  let findingsResolved = 0;
  if (scan.mode === "FULL") {
    const active = await db.finding.findMany({ where: { merchantId: scan.merchantId, siteId: scan.siteId, status: { in: ["OPEN", "NEEDS_REVIEW", "CONFIRMED"] } }, select: { id: true, fingerprint: true } });
    const toResolve = findingsToResolve(active, fingerprints);
    if (toResolve.length) { const result = await db.finding.updateMany({ where: { id: { in: toResolve.map((item) => item.id) } }, data: { status: "RESOLVED", resolvedAt: new Date(), resolvedByScanId: scanId } }); findingsResolved = result.count; }
  }

  await updateProgress(scanId, { stage: "scoring", message: "Calculating the internal ORBIT Health Score", productsDetected, policiesDetected, claimsInspected: pages.reduce((sum, page) => sum + page.content.claims.length, 0), findings: candidates.length });
  await db.scan.update({ where: { id: scanId }, data: { status: "SCORING" } });
  const score = calculateHealthScore([...candidates, ...retainedForScore]);
  const previousScore = await db.healthScore.findFirst({ where: { merchantId: scan.merchantId, scanId: { not: scanId } }, orderBy: { createdAt: "desc" } });
  const scoreComponents = score.components.map((component) => ({ key: component.key, label: component.label, score: component.score, deductions: component.deductions as unknown as Prisma.InputJsonValue }));
  await db.healthScore.upsert({ where: { merchantId_scanId: { merchantId: scan.merchantId, scanId } }, update: { total: score.total, formulaVersion: score.formulaVersion, explanation: score.explanation as unknown as Prisma.InputJsonValue, components: { deleteMany: {}, create: scoreComponents } }, create: { merchantId: scan.merchantId, scanId, total: score.total, formulaVersion: score.formulaVersion, explanation: score.explanation as unknown as Prisma.InputJsonValue, components: { create: scoreComponents } } });
  await db.scan.update({ where: { id: scanId }, data: { status: "COMPLETED", productsDetected, policiesDetected, findingsCreated, findingsResolved, scoreBefore: previousScore?.total, scoreAfter: score.total, completedAt: new Date() } });
  await db.merchant.update({ where: { id: scan.merchantId }, data: { status: candidates.some((finding) => finding.severity === "CRITICAL" || finding.severity === "HIGH") ? "REVIEW_REQUIRED" : "MONITORED" } });
  await db.merchantSite.update({ where: { id: scan.siteId }, data: { nextScanAt: new Date(Date.now() + (await db.merchantSite.findUniqueOrThrow({ where: { id: scan.siteId }, select: { monitoringCadenceMinutes: true } })).monitoringCadenceMinutes * 60_000) } });
  const completionAudit = await db.auditLog.findFirst({ where: { scanId, action: "scan.completed", targetType: "Scan", targetId: scanId }, select: { id: true } });
  if (!completionAudit) await db.auditLog.create({ data: { organizationId: scan.merchant.organizationId, merchantId: scan.merchantId, scanId, action: "scan.completed", targetType: "Scan", targetId: scanId, metadata: { score: score.total, findings: candidates.length, pages: pages.length } } });
  await updateProgress(scanId, { stage: "completed", message: "Scan completed", pagesProcessed: pages.length, pagesTotal: pages.length });
  await Promise.all(evidenceJobs.map((findingId) => queues().evidence.add("capture", { findingId }, { jobId: `evidence-${findingId}-${scanId}` })));
  return { score: score.total, findings: candidates.length, findingsCreated, productsDetected, policiesDetected };
}
