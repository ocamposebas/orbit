import type { Prisma } from "@/generated/prisma/client";
import { contentHash } from "@/sentinel/extraction/normalize";
import { normalizedContentSchema, type CandidateFinding, type SentinelPageType } from "@/sentinel/types";
import { evaluatePage, evaluateSiteCoverage, isReviewableCheckout, requiredPolicyTypes } from "@/sentinel/analysis/rules";
import { CachedSemanticAnalyzer, LocalSemanticAnalyzer } from "@/sentinel/analysis/semantic";
import { evaluateContradictions } from "@/sentinel/analysis/contradictions";
import { findingsToResolve } from "@/sentinel/analysis/lifecycle";
import { calculateHealthScore } from "@/sentinel/analysis/score";
import { getDatabase } from "@/sentinel/db";
import { queues } from "@/sentinel/queue";
import { advanceScanStatus, updateProgress } from "@/sentinel/services/progress";
import { detectPolicySignals, type PolicySignalType } from "@/sentinel/classification/policy-signals";
import { buildProductIntelligence } from "@/sentinel/analysis/product-intelligence";
import { evaluateWebsiteLegitimacy } from "@/sentinel/analysis/legitimacy";
import { analyzeContext } from "@/sentinel/analysis/contextual-signals";
import { consolidateCandidates, isScorableCandidate } from "@/sentinel/analysis/candidate-quality";
import { looksLikeProductUrl } from "@/sentinel/classification/classifier";
import { getServerEnv } from "@/sentinel/config";
import { runHybridSemanticAnalysis, type HybridSemanticStats } from "@/sentinel/analysis/hybrid-semantic";
import { configuredWebsiteSemanticAnalyzer } from "@/sentinel/analysis/website-semantic";

function compactJson(record: Record<string, unknown>): Prisma.InputJsonValue {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as Prisma.InputJsonObject;
}

function storedFindingScoreComponent(categoryValue: string): CandidateFinding["scoreComponent"] {
  const category = categoryValue.toLowerCase();
  if (/policy/.test(category)) return "POLICY_COVERAGE";
  if (/marketing|medical claim|human therapeutic|intended use|human outcome/.test(category)) return "MARKETING_RISK";
  if (/product|disclosure/.test(category)) return "PRODUCT_INTEGRITY";
  if (/checkout/.test(category)) return "SITE_CONTROLS";
  if (/position|contradiction|deceptive|inconsistent|pharmacy|prescription/.test(category)) return "OPERATIONAL_CONSISTENCY";
  return "RESEARCH_CONTROLS";
}

export async function runAnalysisStage(scanId: string) {
  const db = getDatabase();
  const scan = await db.scan.findUniqueOrThrow({ where: { id: scanId }, include: { merchant: true, pages: { include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1 }, changes: { select: { id: true } } } } } });
  await advanceScanStatus(scanId, "ANALYZING");
  await updateProgress(scanId, { stage: "analyzing", message: "Evaluating page context and site coverage", stageProcessed: 0, stageTotal: scan.pages.length });
  const pages = scan.pages.flatMap((page) => {
    const parsed = normalizedContentSchema.safeParse(page.normalizedContent);
    return parsed.success ? [{ id: page.id, snapshotId: page.snapshots[0]?.id, url: page.url, httpStatus: page.httpStatus ?? undefined, pageType: page.pageType as SentinelPageType, content: parsed.data }] : [];
  });
  if (!pages.length) throw new Error("The crawl completed without any valid normalized pages to analyze.");
  const claimAnalyzer = new CachedSemanticAnalyzer(new LocalSemanticAnalyzer());
  const changedPageIds = new Set(scan.pages.filter((page) => page.changes.length > 0).map((page) => page.id));
  const pagesForDeepAnalysis = scan.mode === "INCREMENTAL" ? pages.filter((page) => changedPageIds.has(page.id)) : pages;
  const pageFindingGroups: Awaited<ReturnType<typeof evaluatePage>>[] = [];
  const analysisConcurrency = 8;
  for (let offset = 0; offset < pagesForDeepAnalysis.length; offset += analysisConcurrency) {
    const batch = pagesForDeepAnalysis.slice(offset, offset + analysisConcurrency);
    pageFindingGroups.push(...await Promise.all(batch.map((page) => evaluatePage(page, claimAnalyzer))));
    const processed = Math.min(offset + batch.length, pagesForDeepAnalysis.length);
    await updateProgress(scanId, { stage: "analyzing", message: `Evaluating page context (${processed}/${pagesForDeepAnalysis.length})`, stageProcessed: processed, stageTotal: pagesForDeepAnalysis.length });
  }
  const analysisCoverageRatio = pages.length / Math.max(scan.pagesDiscovered, pages.length, 1);
  const deterministicCandidates = [...pageFindingGroups.flat(), ...evaluateSiteCoverage(pages, { coverageRatio: analysisCoverageRatio }), ...evaluateWebsiteLegitimacy(pages), ...evaluateContradictions(pages)];
  const websiteAnalyzer = configuredWebsiteSemanticAnalyzer();
  let semanticCandidates: CandidateFinding[] = [];
  let semanticStats: HybridSemanticStats | undefined;
  if (websiteAnalyzer) {
    const env = getServerEnv();
    await updateProgress(scanId, { stage: "analyzing", message: "Running structured page and merchant semantic analysis", stageProcessed: pagesForDeepAnalysis.length, stageTotal: pagesForDeepAnalysis.length });
    const semantic = await runHybridSemanticAnalysis({ analyzer: websiteAnalyzer, pages, merchantName: scan.merchant.businessName, deterministicCandidates, concurrency: env.AI_PAGE_CONCURRENCY, maxPageChars: env.AI_MAX_PAGE_CHARS });
    semanticCandidates = semantic.candidates;
    semanticStats = semantic.stats;
  }
  const rawCandidates = [...deterministicCandidates, ...semanticCandidates];
  const candidates = consolidateCandidates(rawCandidates);
  const storedRuleVersions = await db.ruleVersion.findMany({ where: { version: 1, rule: { key: { in: [...new Set(candidates.map((candidate) => candidate.ruleKey))] } } }, include: { rule: { select: { key: true } } } });
  const ruleVersionByKey = new Map(storedRuleVersions.map((version) => [version.rule.key, version]));

  let productsDetected = 0;
  const presentPolicyTypes = new Set<PolicySignalType>();
  for (const page of pages) {
    if (page.httpStatus !== undefined && page.httpStatus >= 400) continue;
    if (page.pageType === "PRODUCT" && page.content.productName) {
      const intelligence = buildProductIntelligence(page.content, page.url, scan.merchant.businessName);
      const numericPrice = page.content.prices[0]?.replace(/[^\d.,]/g, "").replace(",", ".");
      const product = await db.product.upsert({ where: { merchantId_canonicalUrl: { merchantId: scan.merchantId, canonicalUrl: page.url } }, update: { name: page.content.productName, sku: page.content.sku, currentPrice: numericPrice && Number.isFinite(Number(numericPrice)) ? numericPrice : null, claims: page.content.claims, disclaimers: page.content.disclaimers, lastSeenAt: new Date() }, create: { merchantId: scan.merchantId, siteId: scan.siteId, canonicalUrl: page.url, name: page.content.productName, sku: page.content.sku, currentPrice: numericPrice && Number.isFinite(Number(numericPrice)) ? numericPrice : null, claims: page.content.claims, disclaimers: page.content.disclaimers } });
      const productSnapshotPayload = { content: page.content, intelligence };
      const productSnapshotData = { data: productSnapshotPayload as unknown as Prisma.InputJsonValue, hash: contentHash(productSnapshotPayload) };
      const existingProductSnapshot = await db.productSnapshot.findFirst({ where: { productId: product.id, scanId }, select: { id: true } });
      if (existingProductSnapshot) await db.productSnapshot.update({ where: { id: existingProductSnapshot.id }, data: productSnapshotData });
      else await db.productSnapshot.create({ data: { productId: product.id, scanId, ...productSnapshotData } });
      await db.productVariant.deleteMany({ where: { productId: product.id } });
      if (page.content.variants.length) await db.productVariant.createMany({ data: page.content.variants.map((name) => ({ productId: product.id, name })) });
      productsDetected++;
    }
    const detectedPolicyTypes = detectPolicySignals(page.url, page.content, page.pageType);
    for (const policyType of detectedPolicyTypes) {
      presentPolicyTypes.add(policyType);
      const policy = await db.policy.upsert({ where: { merchantId_siteId_type: { merchantId: scan.merchantId, siteId: scan.siteId, type: policyType } }, update: { coverage: "FOUND", url: page.url, currentHash: contentHash(page.content.visibleText), clauses: page.content.paragraphs }, create: { merchantId: scan.merchantId, siteId: scan.siteId, type: policyType, coverage: "FOUND", url: page.url, currentHash: contentHash(page.content.visibleText), clauses: page.content.paragraphs } });
      const policySnapshotData = { text: page.content.visibleText, textHash: contentHash(page.content.visibleText), coverage: "FOUND" as const, clauses: page.content.paragraphs };
      const existingPolicySnapshot = await db.policySnapshot.findFirst({ where: { policyId: policy.id, scanId }, select: { id: true } });
      if (existingPolicySnapshot) await db.policySnapshot.update({ where: { id: existingPolicySnapshot.id }, data: policySnapshotData });
      else await db.policySnapshot.create({ data: { policyId: policy.id, scanId, ...policySnapshotData } });
    }
  }
  const policiesDetected = presentPolicyTypes.size;
  const productsDiscovered = scan.pages.filter((page) => looksLikeProductUrl(page.url)).length;
  const variantsScanned = pages.reduce((sum, page) => sum + (page.pageType === "PRODUCT" ? page.content.variants.length : 0), 0);
  const imagesAnalyzed = pages.reduce((sum, page) => sum + page.content.images.length, 0);
  const certificatesDiscovered = new Set(pages.flatMap((page) => page.content.certificateLinks)).size;
  const checkoutFlowsInspected = pages.filter((page) => page.pageType === "CART" || isReviewableCheckout(page)).length;
  const pageCoveragePercent = Math.min(100, Math.round((pages.length / Math.max(scan.pagesDiscovered, pages.length, 1)) * 100));
  const productCoveragePercent = productsDiscovered > 0 ? Math.min(100, Math.round((productsDetected / productsDiscovered) * 100)) : 100;
  const certificateCoveragePercent = certificatesDiscovered > 0 ? 0 : 100;
  const scanCoveragePercent = Math.round(pageCoveragePercent * 0.65 + productCoveragePercent * 0.2 + certificateCoveragePercent * 0.15);
  const coveragePolicyTypes = ["TERMS", "PRIVACY", "REFUND", "SHIPPING", "CONTACT"] as const;
  const expectedPolicyTypes = requiredPolicyTypes(pages).filter((type): type is (typeof coveragePolicyTypes)[number] => coveragePolicyTypes.includes(type as (typeof coveragePolicyTypes)[number]));
  if (analysisCoverageRatio >= 0.65) for (const type of expectedPolicyTypes) if (!presentPolicyTypes.has(type)) {
    const coverage = analysisCoverageRatio >= 0.85 ? "MISSING" as const : "NEEDS_REVIEW" as const;
    await db.policy.upsert({ where: { merchantId_siteId_type: { merchantId: scan.merchantId, siteId: scan.siteId, type } }, update: { coverage, url: null }, create: { merchantId: scan.merchantId, siteId: scan.siteId, type, coverage } });
  }
  if (analysisCoverageRatio >= 0.85) for (const type of coveragePolicyTypes) if (!expectedPolicyTypes.includes(type) && !presentPolicyTypes.has(type)) await db.policy.upsert({ where: { merchantId_siteId_type: { merchantId: scan.merchantId, siteId: scan.siteId, type } }, update: { coverage: "NOT_APPLICABLE", url: null }, create: { merchantId: scan.merchantId, siteId: scan.siteId, type, coverage: "NOT_APPLICABLE" } });

  const fingerprints = new Set<string>();
  const retainedForScore: CandidateFinding[] = [];
  if (scan.mode === "INCREMENTAL") {
    const changedUrls = new Set(pagesForDeepAnalysis.map((page) => page.url));
    const retained = await db.finding.findMany({ where: { merchantId: scan.merchantId, siteId: scan.siteId, status: { in: ["OPEN", "NEEDS_REVIEW", "CONFIRMED", "ACCEPTED_RISK"] }, url: { notIn: [...changedUrls] } } });
    for (const item of retained) {
      fingerprints.add(item.fingerprint);
      const scoreComponent = storedFindingScoreComponent(item.category);
      retainedForScore.push({ ruleKey: item.fingerprint, severity: item.severity, confidence: item.confidence, status: item.status === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "OPEN", category: item.category, title: item.title, description: item.description, url: item.url, pageType: item.pageType as SentinelPageType, detectedText: item.detectedText ?? undefined, reason: item.reason, recommendedAction: item.recommendedAction, scoreComponent });
    }
  }
  const evidenceJobs: string[] = [];
  let findingsCreated = 0;
  for (const candidate of candidates) {
    const ruleVersion = ruleVersionByKey.get(candidate.ruleKey);
    const repeatedAcrossPages = (candidate.affectedUrls?.length ?? 0) > 1 || candidate.ruleKey.startsWith("SEM-");
    const fingerprint = contentHash(`${candidate.ruleKey}|${repeatedAcrossPages ? "sitewide" : candidate.url}|${candidate.detectedText ?? candidate.title}`);
    fingerprints.add(fingerprint);
    const existing = await db.finding.findFirst({ where: { merchantId: scan.merchantId, fingerprint, status: { notIn: ["RESOLVED", "FALSE_POSITIVE", "IGNORED"] } }, orderBy: { firstDetectedAt: "asc" } });
    const finding = existing ? await db.finding.update({ where: { id: existing.id }, data: { scanId, ruleVersionId: ruleVersion?.id, severity: candidate.severity, confidence: candidate.confidence, status: candidate.status, category: candidate.category, title: candidate.title, url: candidate.url, pageType: candidate.pageType, detectedText: candidate.detectedText, lastDetectedAt: new Date(), description: candidate.description, reason: candidate.reason, recommendedAction: candidate.recommendedAction } }) : await db.finding.create({ data: { organizationId: scan.merchant.organizationId, merchantId: scan.merchantId, siteId: scan.siteId, scanId, ruleVersionId: ruleVersion?.id, severity: candidate.severity, confidence: candidate.confidence, status: candidate.status, category: candidate.category, title: candidate.title, description: candidate.description, url: candidate.url, pageType: candidate.pageType, detectedText: candidate.detectedText, reason: candidate.reason, recommendedAction: candidate.recommendedAction, fingerprint } });
    if (!existing) findingsCreated++;
    const sourcePage = pages.find((page) => page.url === candidate.url);
    const pageHash = sourcePage ? contentHash(sourcePage.content) : fingerprint;
    const modelVersion = candidate.modelVersion ?? claimAnalyzer.model;
    const evidenceMetadata = compactJson({ ruleKey: candidate.ruleKey, role: "primary", affectedUrls: candidate.affectedUrls ?? [], analysisSource: candidate.analysisSource ?? "DETERMINISTIC", evidenceType: candidate.evidenceType, humanReviewRequired: candidate.humanReviewRequired ?? candidate.status === "NEEDS_REVIEW", semanticCategory: candidate.semanticCategory, semanticClassification: candidate.semanticClassification, provider: candidate.provider, promptVersion: candidate.promptVersion });
    const evidenceData = { snapshotId: sourcePage?.snapshotId, pageUrl: candidate.url, normalizedText: candidate.detectedText, evidenceSnippet: candidate.detectedText, pageHash, ruleVersion: ruleVersion ? `${candidate.ruleKey}@${ruleVersion.version}` : undefined, modelVersion, classificationConfidence: candidate.confidence, metadata: evidenceMetadata };
    const existingEvidence = await db.findingEvidence.findFirst({ where: { findingId: finding.id, kind: "TEXT", pageHash, modelVersion, normalizedText: candidate.detectedText ?? null }, select: { id: true } });
    if (existingEvidence) await db.findingEvidence.update({ where: { id: existingEvidence.id }, data: evidenceData });
    else await db.findingEvidence.create({ data: { findingId: finding.id, kind: "TEXT", ...evidenceData } });
    const supportingEvidence = [...(candidate.secondaryEvidence ? [{ ...candidate.secondaryEvidence, evidenceType: undefined }] : []), ...(candidate.supportingEvidence ?? [])];
    const uniqueSupportingEvidence = [...new Map(supportingEvidence.map((evidence) => [`${evidence.url}|${evidence.text}|${evidence.role}`, evidence])).values()];
    for (const supporting of uniqueSupportingEvidence) {
      const secondaryPage = pages.find((page) => page.url === supporting.url);
      const secondaryHash = secondaryPage ? contentHash(secondaryPage.content) : contentHash(supporting.text);
      const secondaryData = { snapshotId: secondaryPage?.snapshotId, pageUrl: supporting.url, normalizedText: supporting.text, evidenceSnippet: supporting.text, pageHash: secondaryHash, ruleVersion: ruleVersion ? `${candidate.ruleKey}@${ruleVersion.version}` : undefined, modelVersion, classificationConfidence: candidate.confidence, metadata: compactJson({ ruleKey: candidate.ruleKey, role: supporting.role, analysisSource: candidate.analysisSource ?? "DETERMINISTIC", evidenceType: supporting.evidenceType, humanReviewRequired: candidate.humanReviewRequired ?? candidate.status === "NEEDS_REVIEW", provider: candidate.provider, promptVersion: candidate.promptVersion }) };
      const existingSecondary = await db.findingEvidence.findFirst({ where: { findingId: finding.id, kind: "TEXT", pageHash: secondaryHash, modelVersion, normalizedText: supporting.text }, select: { id: true } });
      if (existingSecondary) await db.findingEvidence.update({ where: { id: existingSecondary.id }, data: secondaryData });
      else await db.findingEvidence.create({ data: { findingId: finding.id, kind: "TEXT", ...secondaryData } });
    }
    if (candidate.severity === "HIGH" || candidate.severity === "CRITICAL") evidenceJobs.push(finding.id);
  }

  findingsCreated = await db.finding.count({ where: { scanId, firstDetectedAt: { gte: scan.startedAt ?? scan.createdAt } } });

  let findingsResolved = 0;
  if (scan.mode === "FULL" && analysisCoverageRatio >= 0.85) {
    const active = await db.finding.findMany({ where: { merchantId: scan.merchantId, siteId: scan.siteId, status: { in: ["OPEN", "NEEDS_REVIEW", "CONFIRMED"] } }, select: { id: true, fingerprint: true } });
    const toResolve = findingsToResolve(active, fingerprints);
    if (toResolve.length) { const result = await db.finding.updateMany({ where: { id: { in: toResolve.map((item) => item.id) } }, data: { status: "RESOLVED", resolvedAt: new Date(), resolvedByScanId: scanId } }); findingsResolved = result.count; }
  }

  const productPages = pages.filter((page) => page.pageType === "PRODUCT");
  const researchCoveredProducts = productPages.filter((page) => page.content.disclaimers.some((text) => analyzeContext(text).type === "RESEARCH_RESTRICTION")).length;
  const researchRestrictionPagesObserved = pages.filter((page) => [...page.content.disclaimers, ...page.content.paragraphs].some((text) => analyzeContext(text).type === "RESEARCH_RESTRICTION")).length;
  const disclaimerPagesObserved = pages.filter((page) => /\bdisclaimer\b/i.test(`${new URL(page.url).pathname} ${page.content.title} ${page.content.headings.join(" ")}`) && page.content.disclaimers.length > 0).length;
  await updateProgress(scanId, { stage: "scoring", message: "Calculating the internal ORBIT Health Score", productsDetected, productsDiscovered, productsScanned: productsDetected, variantsScanned, imagesAnalyzed, certificatesDiscovered, certificatesAnalyzed: 0, checkoutFlowsInspected, disclaimerPagesObserved, researchRestrictionPagesObserved, researchCoveredProducts, scanCoveragePercent, policiesDetected, claimsInspected: pages.reduce((sum, page) => sum + page.content.claims.length, 0), findings: candidates.length, stageProcessed: 0, stageTotal: 1 });
  await advanceScanStatus(scanId, "SCORING");
  const requiredPoliciesFound = expectedPolicyTypes.filter((type) => presentPolicyTypes.has(type)).length;
  const documentCoverage = certificateCoveragePercent;
  const assessmentCoverage = {
    POLICY_COVERAGE: Math.round(scanCoveragePercent * 0.6 + (requiredPoliciesFound / Math.max(expectedPolicyTypes.length, 1)) * 40),
    PRODUCT_INTEGRITY: productsDiscovered ? productCoveragePercent : 100,
    RESEARCH_CONTROLS: productsDiscovered ? Math.round((researchCoveredProducts / productsDiscovered) * 100) : 100,
    MARKETING_RISK: scanCoveragePercent,
    SITE_CONTROLS: productsDiscovered ? (checkoutFlowsInspected > 0 ? 100 : 0) : 100,
    OPERATIONAL_CONSISTENCY: Math.round(scanCoveragePercent * 0.6 + documentCoverage * 0.4),
  } as const;
  const score = calculateHealthScore([...candidates, ...retainedForScore].filter(isScorableCandidate), assessmentCoverage);
  const previousScore = await db.healthScore.findFirst({ where: { merchantId: scan.merchantId, scanId: { not: scanId } }, orderBy: { createdAt: "desc" } });
  const scoreComponents = score.components.map((component) => ({ key: component.key, label: component.label, score: component.score, deductions: component.deductions as unknown as Prisma.InputJsonValue }));
  await db.healthScore.upsert({ where: { merchantId_scanId: { merchantId: scan.merchantId, scanId } }, update: { total: score.total, formulaVersion: score.formulaVersion, explanation: score.explanation as unknown as Prisma.InputJsonValue, components: { deleteMany: {}, create: scoreComponents } }, create: { merchantId: scan.merchantId, scanId, total: score.total, formulaVersion: score.formulaVersion, explanation: score.explanation as unknown as Prisma.InputJsonValue, components: { create: scoreComponents } } });
  await advanceScanStatus(scanId, "COMPLETED", { productsDetected, policiesDetected, findingsCreated, findingsResolved, scoreBefore: previousScore?.total, scoreAfter: score.total, completedAt: new Date() });
  const activeMaterialFindings = await db.finding.count({ where: { merchantId: scan.merchantId, OR: [
    { status: "OPEN", severity: { in: ["HIGH", "CRITICAL"] }, confidence: { gte: 0.9 } },
    { status: { in: ["NEEDS_REVIEW", "CONFIRMED"] }, severity: { in: ["HIGH", "CRITICAL"] }, confidence: { gte: 0.9 }, detectedText: { not: null } },
  ] } });
  await db.merchant.update({ where: { id: scan.merchantId }, data: { status: activeMaterialFindings > 0 ? "REVIEW_REQUIRED" : "MONITORED" } });
  await db.merchantSite.update({ where: { id: scan.siteId }, data: { nextScanAt: new Date(Date.now() + (await db.merchantSite.findUniqueOrThrow({ where: { id: scan.siteId }, select: { monitoringCadenceMinutes: true } })).monitoringCadenceMinutes * 60_000) } });
  const completionAudit = await db.auditLog.findFirst({ where: { scanId, action: "scan.completed", targetType: "Scan", targetId: scanId }, select: { id: true } });
  if (!completionAudit) await db.auditLog.create({ data: { organizationId: scan.merchant.organizationId, merchantId: scan.merchantId, scanId, action: "scan.completed", targetType: "Scan", targetId: scanId, metadata: compactJson({ score: score.total, findings: candidates.length, pages: pages.length, semantic: semanticStats }) } });
  await updateProgress(scanId, { stage: "completed", message: "Scan completed", pagesProcessed: pages.length, pagesTotal: pages.length, stageProcessed: 1, stageTotal: 1 });
  await Promise.all(evidenceJobs.map((findingId) => queues().evidence.add("capture", { findingId }, { jobId: `evidence-${findingId}-${scanId}` })));
  return { score: score.total, findings: candidates.length, findingsCreated, productsDetected, policiesDetected };
}
