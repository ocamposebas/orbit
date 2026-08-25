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
import { hasProductEvidence, isEditorialUrl, looksLikeProductUrl, verifiedCanonicalProductUrl } from "@/sentinel/classification/classifier";
import { coverageForAssessment, surfaceCoverage, weightedCoverage } from "@/sentinel/analysis/coverage";
import { getServerEnv } from "@/sentinel/config";
import { merchantSemanticCandidates, runHybridSemanticAnalysis, runMerchantSemanticPass, type HybridSemanticStats } from "@/sentinel/analysis/hybrid-semantic";
import { configuredWebsiteSemanticAnalyzer } from "@/sentinel/analysis/website-semantic";
import { runVisualIntelligence } from "@/sentinel/analysis/visual-intelligence";
import { runDocumentIntelligence } from "@/sentinel/analysis/document-intelligence";
import { buildEvidenceGraph } from "@/sentinel/analysis/evidence-graph";
import { loadEvidenceManifest, persistPageEvidenceLedger } from "@/sentinel/evidence/ledger";
import { configuredLunaReviewer, persistLunaObservations } from "@/sentinel/review/luna";
import { configuredLunaCritic } from "@/sentinel/review/critic";
import { adjudicateDualReview, attachRetainedCandidateEvidence } from "@/sentinel/review/adjudication";
import { persistVerificationFacts, verifyEvidenceManifest } from "@/sentinel/verification/verifier";
import { logger } from "@/sentinel/logger";
import { collectMerchantImages } from "@/sentinel/evidence/collect-images";
import { runExternalPublicWebVerification } from "@/sentinel/review/external-verification";

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

function enrichCandidateProvenance(candidate: CandidateFinding, pages: Array<{ url: string; pageType: SentinelPageType; content: ReturnType<typeof normalizedContentSchema.parse> }>): CandidateFinding {
  if (candidate.domSelector || !candidate.detectedText) return candidate;
  const page = pages.find((item) => item.url === candidate.url);
  if (!page) return candidate;
  const needle = candidate.detectedText.replace(/\s+/g, " ").trim().toLowerCase();
  const located = page.content.domEvidence.find((item) => item.text.replace(/\s+/g, " ").trim().toLowerCase().includes(needle));
  if (!located) return candidate;
  const prominence: CandidateFinding["prominence"] = candidate.prominence ?? (page.pageType === "PRODUCT" || page.pageType === "COLLECTION" || page.pageType === "CATEGORY" || located.evidenceType === "CTA" ? "PRIMARY_COMMERCIAL" : page.pageType === "ARTICLE" || page.pageType === "BLOG" ? "EDITORIAL" : "SITEWIDE");
  return { ...candidate, domSelector: located.selector, evidenceType: candidate.evidenceType ?? located.evidenceType, sourceKind: candidate.sourceKind ?? "TEXT", prominence };
}

export async function runAnalysisStage(scanId: string) {
  const db = getDatabase();
  const env = getServerEnv();
  const scan = await db.scan.findUniqueOrThrow({ where: { id: scanId }, include: { merchant: true, pages: { include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1 }, changes: { select: { id: true } } } } } });
  await advanceScanStatus(scanId, "ANALYZING");
  await updateProgress(scanId, { stage: "analyzing", message: "Evaluating page context and site coverage", stageProcessed: 0, stageTotal: scan.pages.length });
  const pages = scan.pages.flatMap((page) => {
    const parsed = normalizedContentSchema.safeParse(page.normalizedContent);
    return parsed.success ? [{ id: page.id, snapshotId: page.snapshots[0]?.id, url: page.url, canonicalUrl: page.canonicalUrl ?? page.url, httpStatus: page.httpStatus ?? undefined, pageType: page.pageType as SentinelPageType, content: parsed.data }] : [];
  });
  if (!pages.length) throw new Error("The crawl completed without any valid normalized pages to analyze.");
  await persistPageEvidenceLedger(scanId, pages);
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
  const websiteAnalyzer = env.DUAL_REVIEW_MODE === "enforced" ? undefined : configuredWebsiteSemanticAnalyzer();
  let semanticCandidates: CandidateFinding[] = [];
  let semanticStats: HybridSemanticStats | undefined;
  let semanticPageAnalyses: Awaited<ReturnType<typeof runHybridSemanticAnalysis>>["pageAnalyses"] = [];
  if (websiteAnalyzer) {
    await updateProgress(scanId, { stage: "analyzing", message: "Running structured page and merchant semantic analysis", stageProcessed: pagesForDeepAnalysis.length, stageTotal: pagesForDeepAnalysis.length });
    const semantic = await runHybridSemanticAnalysis({ analyzer: websiteAnalyzer, pages, merchantName: scan.merchant.businessName, deterministicCandidates, concurrency: env.AI_PAGE_CONCURRENCY, maxPageChars: env.AI_MAX_PAGE_CHARS, skipMerchant: true });
    semanticCandidates = semantic.candidates;
    semanticPageAnalyses = semantic.pageAnalyses;
    semanticStats = semantic.stats;
  }
  await updateProgress(scanId, { stage: "analyzing", message: "Inspecting visual and public-document evidence", stageProcessed: pagesForDeepAnalysis.length, stageTotal: pagesForDeepAnalysis.length });
  const legacySpecialistAnalysis = env.DUAL_REVIEW_MODE !== "enforced";
  const [visual, documents, collectedImages] = await Promise.all([runVisualIntelligence(scanId, pages, { analyzeSemantic: legacySpecialistAnalysis }), runDocumentIntelligence(scanId, pages, { analyzeSemantic: legacySpecialistAnalysis }), collectMerchantImages(scanId, pages)]);
  const preliminaryCandidates = [...deterministicCandidates, ...semanticCandidates, ...visual.candidates, ...documents.candidates];
  if (websiteAnalyzer) {
    const merchant = await runMerchantSemanticPass({ analyzer: websiteAnalyzer, pages, merchantName: scan.merchant.businessName, pageAnalyses: semanticPageAnalyses, candidates: preliminaryCandidates });
    semanticCandidates.push(...merchantSemanticCandidates(merchant.analysis, pages, websiteAnalyzer.provider, websiteAnalyzer.model));
    if (semanticStats) {
      semanticStats.merchantCalls += merchant.stats.merchantCalls; semanticStats.cacheHits += merchant.stats.cacheHits; semanticStats.failures += merchant.stats.failures;
      semanticStats.inputTokens += merchant.stats.inputTokens; semanticStats.outputTokens += merchant.stats.outputTokens; semanticStats.estimatedCostUsd = Number((semanticStats.estimatedCostUsd + merchant.stats.estimatedCostUsd).toFixed(6));
    }
  }
  const rawCandidates = [...deterministicCandidates, ...semanticCandidates, ...visual.candidates, ...documents.candidates];
  const consolidatedLegacyCandidates = consolidateCandidates(rawCandidates.map((candidate) => enrichCandidateProvenance(candidate, pages)));
  const manifest = await loadEvidenceManifest(scanId);
  const legacyCandidates = consolidatedLegacyCandidates.map((candidate) => attachRetainedCandidateEvidence(candidate, manifest));
  const verifierFacts = verifyEvidenceManifest(manifest);
  const lunaReviewer = configuredLunaReviewer();
  const reviewPromise = lunaReviewer?.review({ scanId, merchantId: scan.merchantId, merchantName: scan.merchant.businessName, merchantDescription: scan.merchant.businessDescription, manifest });
  const verificationPromise = persistVerificationFacts(scanId, verifierFacts);
  let lunaResult: Awaited<NonNullable<typeof reviewPromise>> | undefined;
  try { lunaResult = await reviewPromise; }
  catch (error) { logger.error({ error, scanId }, "Primary holistic Luna review failed; semantic conclusions will remain unscored and require review"); }
  await verificationPromise;
  if (lunaResult) await persistLunaObservations(lunaResult.runId, lunaResult.review);
  let externalVerification: Awaited<ReturnType<typeof runExternalPublicWebVerification>> | undefined;
  if (lunaResult) try { externalVerification = await runExternalPublicWebVerification({ scanId, merchantId: scan.merchantId, merchantUrl: pages[0].url, review: lunaResult.review }); }
  catch (error) { logger.warn({ error, scanId }, "Optional external public-web verification failed; first-party review remains available"); }
  let adjudicatedCandidates = legacyCandidates;
  let materialDisagreements = 0;
  let criticRunId: string | undefined;
  if (env.DUAL_REVIEW_MODE !== "off") {
    const adjudicated = await adjudicateDualReview({ scanId, merchantId: scan.merchantId, deterministicCandidates: legacyCandidates, review: lunaResult?.review, reviewRunId: lunaResult?.runId, manifest, verifierFacts, critic: configuredLunaCritic(), maxDisagreements: env.AI_CRITIC_MAX_DISAGREEMENTS });
    materialDisagreements = adjudicated.materialDisagreements;
    criticRunId = adjudicated.criticRunId;
    if (env.DUAL_REVIEW_MODE === "enforced") adjudicatedCandidates = adjudicated.candidates;
  }
  const candidates = consolidateCandidates(adjudicatedCandidates.map((candidate) => enrichCandidateProvenance(candidate, pages)));
  const pageRestrictions = pages.flatMap((page) => page.content.disclaimers.filter((text) => analyzeContext(text).type === "RESEARCH_RESTRICTION").map((text) => ({ url: page.url, pageType: page.pageType, text })));
  for (const candidate of candidates) if (candidate.scoreComponent === "MARKETING_RISK" && !candidate.riskTheme?.startsWith("CONTRADICTION:")) candidate.mitigatingEvidence = pageRestrictions.slice(0, 12).map((restriction) => ({ url: restriction.url, text: restriction.text, role: "merchant-level-restriction", evidenceType: "DISCLAIMER", classification: "MITIGATING" }));
  const storedRuleVersions = await db.ruleVersion.findMany({ where: { version: 1, rule: { key: { in: [...new Set(candidates.map((candidate) => candidate.ruleKey))] } } }, include: { rule: { select: { key: true } } } });
  const ruleVersionByKey = new Map(storedRuleVersions.map((version) => [version.rule.key, version]));

  let productsDetected = 0;
  const presentPolicyTypes = new Set<PolicySignalType>();
  for (const page of pages) {
    if (page.httpStatus !== undefined && page.httpStatus >= 400) continue;
    if (page.pageType === "PRODUCT" && page.content.productName && hasProductEvidence(page.content, page.url) && !isEditorialUrl(page.url)) {
      const canonicalUrl = verifiedCanonicalProductUrl(page.url, page.canonicalUrl);
      const intelligence = buildProductIntelligence(page.content, canonicalUrl, scan.merchant.businessName);
      const numericPrice = page.content.prices[0]?.replace(/[^\d.,]/g, "").replace(",", ".");
      const availability = page.content.stockText.map((item) => item.text).join(" | ").slice(0, 500) || undefined;
      const product = await db.product.upsert({ where: { merchantId_canonicalUrl: { merchantId: scan.merchantId, canonicalUrl } }, update: { name: page.content.productName, sku: page.content.sku, currentPrice: numericPrice && Number.isFinite(Number(numericPrice)) ? numericPrice : null, availability, categories: page.content.productCategories, claims: page.content.claims, disclaimers: page.content.disclaimers, lastSeenAt: new Date() }, create: { merchantId: scan.merchantId, siteId: scan.siteId, canonicalUrl, name: page.content.productName, sku: page.content.sku, currentPrice: numericPrice && Number.isFinite(Number(numericPrice)) ? numericPrice : null, availability, categories: page.content.productCategories, claims: page.content.claims, disclaimers: page.content.disclaimers } });
      const productSnapshotPayload = { content: page.content, intelligence };
      const productSnapshotData = { data: productSnapshotPayload as unknown as Prisma.InputJsonValue, hash: contentHash(productSnapshotPayload) };
      const existingProductSnapshot = await db.productSnapshot.findFirst({ where: { productId: product.id, scanId }, select: { id: true } });
      if (existingProductSnapshot) await db.productSnapshot.update({ where: { id: existingProductSnapshot.id }, data: productSnapshotData });
      else await db.productSnapshot.create({ data: { productId: product.id, scanId, ...productSnapshotData } });
      await db.productVariant.deleteMany({ where: { productId: product.id } });
      const variants: Array<{ name: string; sku?: string; price?: string; availability?: string }> = page.content.productVariations.length ? page.content.productVariations : page.content.variants.map((name) => ({ name }));
      if (variants.length) await db.productVariant.createMany({ data: variants.map((variant) => ({ productId: product.id, name: variant.name, sku: variant.sku, price: variant.price && Number.isFinite(Number(variant.price.replace(/[^\d.]/g, ""))) ? variant.price.replace(/[^\d.]/g, "") : undefined, availability: variant.availability })) });
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
  const productCandidates = scan.pages.filter((page) => !isEditorialUrl(page.url) && (page.pageType === "PRODUCT" || looksLikeProductUrl(page.url)));
  const productsDiscovered = productCandidates.length;
  const variantsScanned = pages.reduce((sum, page) => sum + (page.pageType === "PRODUCT" ? Math.max(page.content.variants.length, page.content.productVariations.length) : 0), 0);
  const imagesDiscovered = pages.reduce((sum, page) => sum + page.content.images.length, 0);
  const imagesAnalyzed = visual.stats.assetsAnalyzed;
  const certificatesDiscovered = new Set(pages.flatMap((page) => page.content.certificateLinks)).size;
  const checkoutFlowsInspected = pages.filter((page) => page.pageType === "CART" || isReviewableCheckout(page)).length;
  const checkoutStatesInspected = pages.filter((page) => page.pageType === "CART" || page.pageType === "CHECKOUT").reduce((sum, page) => sum + Math.max(1, page.content.interactiveStates.length), 0);
  const pageCoveragePercent = Math.min(100, Math.round((pages.length / Math.max(scan.pagesDiscovered, pages.length, 1)) * 100));
  const semanticCoveragePercent = lunaResult ? 100 : websiteAnalyzer ? Math.round((semanticPageAnalyses.length / Math.max(pages.length, 1)) * 100) : 0;
  const inaccessibleAreas = scan.pages.filter((page) => Boolean(page.inaccessibleReason) || (page.httpStatus ?? 0) >= 400).length;
  const commerceApplicable = productsDiscovered > 0 || pages.some((page) => page.pageType === "CART" || page.pageType === "CHECKOUT");
  const coverageSurfaces = {
    pages: surfaceCoverage({ inspected: pages.length, expected: Math.max(scan.pagesDiscovered, pages.length, 1) }),
    products: surfaceCoverage({ inspected: productsDetected, expected: productsDiscovered, applicable: productsDiscovered > 0, known: analysisCoverageRatio >= 0.65 }),
    semantic: surfaceCoverage({ inspected: lunaResult ? pages.length : semanticPageAnalyses.length, expected: pages.length }),
    visual: surfaceCoverage({ inspected: visual.stats.pagesAnalyzed, expected: visual.stats.pagesSelected, applicable: visual.stats.pagesSelected > 0 }),
    documents: surfaceCoverage({ inspected: documents.stats.extracted, expected: documents.stats.discovered, applicable: documents.stats.discovered > 0 }),
    checkout: surfaceCoverage({ inspected: checkoutStatesInspected, expected: commerceApplicable ? 1 : 0, applicable: commerceApplicable, known: analysisCoverageRatio >= 0.65 }),
  };
  const visualCoveragePercent = coverageSurfaces.visual.percent ?? 0;
  const documentCoveragePercent = coverageSurfaces.documents.percent ?? 0;
  const scanCoveragePercent = weightedCoverage([
    { weight: 0.4, coverage: coverageSurfaces.pages },
    { weight: 0.15, coverage: coverageSurfaces.products },
    { weight: 0.15, coverage: coverageSurfaces.semantic },
    { weight: 0.1, coverage: coverageSurfaces.visual },
    { weight: 0.1, coverage: coverageSurfaces.documents },
    { weight: 0.1, coverage: coverageSurfaces.checkout },
  ]);
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
    const fingerprint = candidate.riskTheme ? contentHash(`${candidate.scoreComponent}|${candidate.riskTheme}`) : contentHash(`${candidate.ruleKey}|${repeatedAcrossPages ? "sitewide" : candidate.url}|${candidate.detectedText ?? candidate.title}`);
    fingerprints.add(fingerprint);
    const existing = await db.finding.findFirst({ where: { merchantId: scan.merchantId, fingerprint, status: { notIn: ["RESOLVED", "FALSE_POSITIVE", "IGNORED"] } }, orderBy: { firstDetectedAt: "asc" } });
    const finding = existing ? await db.finding.update({ where: { id: existing.id }, data: { scanId, ruleVersionId: ruleVersion?.id, adjudicationId: candidate.adjudicationId, severity: candidate.severity, confidence: candidate.confidence, status: candidate.status, category: candidate.category, title: candidate.title, url: candidate.url, pageType: candidate.pageType, detectedText: candidate.detectedText, lastDetectedAt: new Date(), description: candidate.description, reason: candidate.reason, recommendedAction: candidate.recommendedAction } }) : await db.finding.create({ data: { organizationId: scan.merchant.organizationId, merchantId: scan.merchantId, siteId: scan.siteId, scanId, ruleVersionId: ruleVersion?.id, adjudicationId: candidate.adjudicationId, severity: candidate.severity, confidence: candidate.confidence, status: candidate.status, category: candidate.category, title: candidate.title, description: candidate.description, url: candidate.url, pageType: candidate.pageType, detectedText: candidate.detectedText, reason: candidate.reason, recommendedAction: candidate.recommendedAction, fingerprint } });
    if (!existing) findingsCreated++;
    const sourcePage = pages.find((page) => page.url === candidate.url);
    const pageHash = sourcePage ? contentHash(sourcePage.content) : fingerprint;
    const modelVersion = candidate.modelVersion ?? claimAnalyzer.model;
    const evidenceMetadata = compactJson({ ruleKey: candidate.ruleKey, role: "primary", affectedUrls: candidate.affectedUrls ?? [], analysisSource: candidate.analysisSource ?? "DETERMINISTIC", evidenceType: candidate.evidenceType, evidenceClassification: candidate.evidenceClassification, prominence: candidate.prominence, sourceKind: candidate.sourceKind ?? "TEXT", domSelector: candidate.domSelector, assetHash: candidate.assetHash, humanReviewRequired: candidate.humanReviewRequired ?? candidate.status === "NEEDS_REVIEW", semanticCategory: candidate.semanticCategory, semanticClassification: candidate.semanticClassification, provider: candidate.provider, promptVersion: candidate.promptVersion, riskTheme: candidate.riskTheme });
    const evidenceData = { snapshotId: sourcePage?.snapshotId, evidenceRecordId: candidate.evidenceRecordIds?.[0], pageUrl: candidate.url, normalizedText: candidate.detectedText, evidenceSnippet: candidate.detectedText, pageHash, ruleVersion: ruleVersion ? `${candidate.ruleKey}@${ruleVersion.version}` : undefined, modelVersion, classificationConfidence: candidate.confidence, metadata: evidenceMetadata };
    const existingEvidence = await db.findingEvidence.findFirst({ where: { findingId: finding.id, kind: "TEXT", pageHash, modelVersion, normalizedText: candidate.detectedText ?? null }, select: { id: true } });
    if (existingEvidence) await db.findingEvidence.update({ where: { id: existingEvidence.id }, data: evidenceData });
    else await db.findingEvidence.create({ data: { findingId: finding.id, kind: "TEXT", ...evidenceData } });
    if (candidate.assetStorageKey && candidate.assetHash) {
      const assetKind = candidate.sourceKind === "DOCUMENT" ? "SNAPSHOT" as const : "SCREENSHOT" as const;
      const assetEvidence = await db.findingEvidence.findFirst({ where: { findingId: finding.id, kind: assetKind, storageKey: candidate.assetStorageKey }, select: { id: true } });
      if (!assetEvidence) await db.findingEvidence.create({ data: { findingId: finding.id, kind: assetKind, snapshotId: sourcePage?.snapshotId, pageUrl: candidate.url, normalizedText: candidate.detectedText, evidenceSnippet: candidate.detectedText, pageHash: candidate.assetHash, domSelector: candidate.domSelector, storageKey: candidate.assetStorageKey, modelVersion, classificationConfidence: candidate.confidence, metadata: evidenceMetadata } });
    }
    const supportingEvidence = [...(candidate.secondaryEvidence ? [{ ...candidate.secondaryEvidence, evidenceType: undefined }] : []), ...(candidate.supportingEvidence ?? []), ...(candidate.mitigatingEvidence ?? [])];
    const uniqueSupportingEvidence = [...new Map(supportingEvidence.map((evidence) => [`${evidence.url}|${evidence.text}|${evidence.role}`, evidence])).values()];
    for (const supporting of uniqueSupportingEvidence) {
      const secondaryPage = pages.find((page) => page.url === supporting.url);
      const secondaryHash = supporting.assetHash ?? (secondaryPage ? contentHash(secondaryPage.content) : contentHash(supporting.text));
      const secondaryMetadata = compactJson({ ruleKey: candidate.ruleKey, role: supporting.role, analysisSource: candidate.analysisSource ?? "DETERMINISTIC", evidenceType: supporting.evidenceType, evidenceClassification: supporting.classification, prominence: candidate.prominence, sourceKind: supporting.sourceKind ?? "TEXT", domSelector: supporting.domSelector, assetHash: supporting.assetHash, humanReviewRequired: candidate.humanReviewRequired ?? candidate.status === "NEEDS_REVIEW", provider: candidate.provider, promptVersion: candidate.promptVersion, riskTheme: candidate.riskTheme });
      const secondaryData = { snapshotId: secondaryPage?.snapshotId, evidenceRecordId: supporting.evidenceRecordId, pageUrl: supporting.url, normalizedText: supporting.text, evidenceSnippet: supporting.text, pageHash: secondaryHash, domSelector: supporting.domSelector, ruleVersion: ruleVersion ? `${candidate.ruleKey}@${ruleVersion.version}` : undefined, modelVersion, classificationConfidence: candidate.confidence, metadata: secondaryMetadata };
      const existingSecondary = await db.findingEvidence.findFirst({ where: { findingId: finding.id, kind: "TEXT", pageHash: secondaryHash, modelVersion, normalizedText: supporting.text }, select: { id: true } });
      if (existingSecondary) await db.findingEvidence.update({ where: { id: existingSecondary.id }, data: secondaryData });
      else await db.findingEvidence.create({ data: { findingId: finding.id, kind: "TEXT", ...secondaryData } });
      if (supporting.assetStorageKey && supporting.assetHash) {
        const assetKind = supporting.sourceKind === "DOCUMENT" ? "SNAPSHOT" as const : "SCREENSHOT" as const;
        const assetEvidence = await db.findingEvidence.findFirst({ where: { findingId: finding.id, kind: assetKind, storageKey: supporting.assetStorageKey }, select: { id: true } });
        if (!assetEvidence) await db.findingEvidence.create({ data: { findingId: finding.id, kind: assetKind, ...secondaryData, storageKey: supporting.assetStorageKey } });
      }
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
  await updateProgress(scanId, { stage: "scoring", message: "Calculating the internal ORBIT Health Score", productsDetected, productsDiscovered, productsScanned: productsDetected, variantsScanned, imagesDiscovered, imagesAnalyzed, screenshotsAnalyzed: visual.stats.assetsAnalyzed, visualPagesAnalyzed: visual.stats.pagesAnalyzed, visualCoveragePercent, certificatesDiscovered, certificatesAnalyzed: documents.stats.extracted, documentsDiscovered: documents.stats.discovered, documentsAnalyzed: documents.stats.extracted, documentCoveragePercent, checkoutFlowsInspected, checkoutStatesInspected, semanticPagesAnalyzed: lunaResult ? pages.length : semanticPageAnalyses.length, semanticCoveragePercent, inaccessibleAreas, disclaimerPagesObserved, researchRestrictionPagesObserved, researchCoveredProducts, scanCoveragePercent, coverageStates: Object.fromEntries(Object.entries(coverageSurfaces).map(([key, value]) => [key, value.state])), policiesDetected, claimsInspected: pages.reduce((sum, page) => sum + page.content.claims.length, 0), findings: candidates.length, stageProcessed: 0, stageTotal: 1 });
  await advanceScanStatus(scanId, "SCORING");
  const requiredPoliciesFound = expectedPolicyTypes.filter((type) => presentPolicyTypes.has(type)).length;
  const assessmentCoverage = {
    POLICY_COVERAGE: Math.round(pageCoveragePercent * 0.6 + (requiredPoliciesFound / Math.max(expectedPolicyTypes.length, 1)) * 40),
    PRODUCT_INTEGRITY: Math.round(coverageForAssessment(coverageSurfaces.products) * 0.55 + coverageForAssessment(coverageSurfaces.visual) * 0.2 + coverageForAssessment(coverageSurfaces.documents) * 0.25),
    RESEARCH_CONTROLS: productsDiscovered ? Math.round((researchCoveredProducts / Math.max(productsDiscovered, 1)) * 70 + semanticCoveragePercent * 0.3) : semanticCoveragePercent,
    MARKETING_RISK: Math.round(pageCoveragePercent * 0.45 + semanticCoveragePercent * 0.3 + visualCoveragePercent * 0.25),
    SITE_CONTROLS: coverageForAssessment(coverageSurfaces.checkout),
    OPERATIONAL_CONSISTENCY: Math.round(pageCoveragePercent * 0.5 + semanticCoveragePercent * 0.25 + coverageForAssessment(coverageSurfaces.documents) * 0.25),
  } as const;
  const score = calculateHealthScore([...candidates, ...retainedForScore].filter(isScorableCandidate), assessmentCoverage);
  const evidenceGraph = buildEvidenceGraph(candidates, pageRestrictions);
  const lunaEstimatedCostUsd = lunaResult ? lunaResult.usage.inputTokens * env.AI_INPUT_COST_PER_MILLION / 1_000_000 + lunaResult.usage.outputTokens * env.AI_OUTPUT_COST_PER_MILLION / 1_000_000 : 0;
  const estimatedCostUsd = Number(((semanticStats?.estimatedCostUsd ?? 0) + lunaEstimatedCostUsd + visual.stats.estimatedCostUsd + documents.stats.estimatedCostUsd).toFixed(6));
  const dualReview = { mode: env.DUAL_REVIEW_MODE, evidenceManifestVersion: manifest.version, retainedFirstPartyEvidenceRecords: manifest.records.filter((record) => record.scope === "MERCHANT_SITE").length, verifierAssertions: verifierFacts.length, luna: lunaResult ? { model: env.AI_REVIEW_MODEL, promptVersion: "orbit-luna-holistic-v1", reviewRunId: lunaResult.runId, runIds: lunaResult.runIds, usage: lunaResult.usage } : null, externalPublicWeb: externalVerification ? { reviewRunId: externalVerification.runId, resultCount: externalVerification.result.results.length, evidenceScope: "EXTERNAL_PUBLIC_WEB" } : null, materialDisagreements, criticRunId: criticRunId ?? null, scoreAuthority: "deterministic" };
  const intelligence = { version: "orbit-dual-review-v1", riskScore: 100 - score.total, healthScore: score.total, coverage: { overall: scanCoveragePercent, surfaces: coverageSurfaces, inaccessibleAreas }, evidenceGraph, dualReview, visual: { ...visual.stats, merchantImages: collectedImages }, documents: { stats: documents.stats, records: documents.documents.map((document) => ({ url: document.url, sourcePageUrl: document.sourcePageUrl, documentType: document.documentType, hash: document.hash, storageKey: document.storageKey, pageCount: document.pageCount, metadata: document.metadata })) }, model: { semantic: semanticStats, estimatedCostUsd, fallbackIncomplete: env.DUAL_REVIEW_MODE === "enforced" ? !lunaResult : !websiteAnalyzer || Boolean((semanticStats?.failures ?? 0) + visual.stats.failures + documents.stats.failures) }, methodologyLimitations: [...(env.DUAL_REVIEW_MODE === "enforced" && !lunaResult ? ["Primary holistic Luna review was unavailable; semantic signals were retained as NEEDS_REVIEW and excluded from scoring."] : []), ...(visual.stats.failures ? [`${visual.stats.failures} visual evidence collection attempt(s) failed.`] : []), ...(documents.stats.failures ? [`${documents.stats.failures} public document extraction attempt(s) failed.`] : []), ...(collectedImages.failed ? [`${collectedImages.failed} public image retrieval attempt(s) failed.`] : []), ...(["NOT_OBSERVED", "UNKNOWN"].includes(coverageSurfaces.checkout.state) ? ["A populated public checkout state was not observable without an explicitly enabled anonymous cart action."] : [])] };
  await db.scan.update({ where: { id: scanId }, data: { intelligence: intelligence as unknown as Prisma.InputJsonValue } });
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
  if (!completionAudit) await db.auditLog.create({ data: { organizationId: scan.merchant.organizationId, merchantId: scan.merchantId, scanId, action: "scan.completed", targetType: "Scan", targetId: scanId, metadata: compactJson({ score: score.total, riskScore: 100 - score.total, findings: candidates.length, pages: pages.length, semantic: semanticStats, visual: visual.stats, documents: documents.stats, estimatedCostUsd }) } });
  await updateProgress(scanId, { stage: "completed", message: "Scan completed", pagesProcessed: pages.length, pagesTotal: pages.length, stageProcessed: 1, stageTotal: 1 });
  await Promise.all(evidenceJobs.map((findingId) => queues().evidence.add("capture", { findingId }, { jobId: `evidence-${findingId}-${scanId}` })));
  return { score: score.total, findings: candidates.length, findingsCreated, productsDetected, policiesDetected };
}
