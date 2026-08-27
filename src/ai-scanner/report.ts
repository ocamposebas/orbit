import { chromium } from "playwright";
import type { Prisma } from "@/generated/prisma/client";
import { getDatabase } from "@/sentinel/db";
import { evidenceStorage } from "@/sentinel/storage";
import { deriveAiPolicyCoverage } from "./policy-coverage";

const severityRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
const activeFindingStatuses = new Set(["OPEN", "NEEDS_REVIEW", "CONFIRMED", "ACCEPTED_RISK"]);

const aiScanReportInclude = {
  merchant: true,
  site: true,
  evidence: { where: { validated: true }, orderBy: { capturedAt: "asc" as const }, take: 1_000 },
  products: { orderBy: { createdAt: "asc" as const } },
  findings: {
    orderBy: { createdAt: "asc" as const },
    include: { evidence: { include: { evidence: true }, orderBy: { id: "asc" as const } }, criticReview: true },
  },
} satisfies Prisma.AiScanInclude;

export type AiScanReportData = Prisma.AiScanGetPayload<{ include: typeof aiScanReportInclude }>;
type ReportFinding = AiScanReportData["findings"][number];
type FindingEvidenceLink = ReportFinding["evidence"][number];

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const jsonRecord = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const stringArray = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const finiteNumber = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;

function formatDate(value: Date | null | undefined) {
  if (!value) return "Not available";
  return `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(value)} UTC`;
}

function formatDuration(milliseconds: number) {
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  const seconds = Math.round(milliseconds / 1_000);
  if (seconds < 60) return `${seconds} sec`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function scoreState(score: number | null, status: string) {
  if (status === "AI_SCAN_FAILED") return { label: "Assessment unavailable", tone: "risk" };
  if (status === "AI_SCAN_INCOMPLETE") return { label: "Incomplete assessment", tone: "review" };
  if (score === null) return { label: "Awaiting assessment", tone: "muted" };
  if (score >= 85) return { label: "Healthy", tone: "good" };
  if (score >= 65) return { label: "Review recommended", tone: "review" };
  return { label: "Attention required", tone: "risk" };
}

export async function loadAiScanReport(scanId: string) {
  return getDatabase().aiScan.findUniqueOrThrow({ where: { id: scanId }, include: aiScanReportInclude });
}

export async function renderAiScanReportPdf(scanId: string) {
  const scan = await loadAiScanReport(scanId);
  const visualEvidence = [...new Map(
    scan.findings.flatMap((finding) => finding.evidence.map((link) => link.evidence))
      .filter((evidence) => evidence.storageKey && evidence.mimeType?.startsWith("image/"))
      .map((evidence) => [evidence.id, evidence]),
  ).values()].slice(0, 24);
  const imageData = new Map<string, string>();
  for (const evidence of visualEvidence) {
    const bytes = evidence.storageKey ? await evidenceStorage().get(evidence.storageKey).catch(() => undefined) : undefined;
    if (bytes?.length) imageData.set(evidence.id, `data:${evidence.mimeType ?? "image/jpeg"};base64,${Buffer.from(bytes).toString("base64")}`);
  }

  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(aiScanReportHtml(scan, imageData), { waitUntil: "load" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "13mm", right: "13mm", bottom: "17mm", left: "13mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: '<div style="box-sizing:border-box;width:100%;padding:0 13mm;font:7px Arial;color:#747984;letter-spacing:.35px;display:flex;justify-content:space-between"><span>ORBIT · AI SCANNER V1 · CONFIDENTIAL</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
    });
  } finally {
    await browser.close();
  }
}

function evidenceGroup(title: string, tone: string, evidence: FindingEvidenceLink[], images: Map<string, string>) {
  const cards = evidence.map((link) => {
    const item = link.evidence;
    const image = images.get(item.id);
    const excerpt = item.exactText?.replace(/\s+/g, " ").trim().slice(0, 1_800);
    return `<div class="evidence-card ${image ? "with-visual" : ""}"><div class="evidence-copy"><div class="evidence-meta"><span>${escapeHtml(item.kind.replaceAll("_", " "))}</span><span>Evidence ${escapeHtml(item.id)}</span></div>${link.rationale ? `<p class="rationale">${escapeHtml(link.rationale)}</p>` : ""}${excerpt ? `<blockquote>&ldquo;${escapeHtml(excerpt)}${item.exactText && item.exactText.length > 1_800 ? "…" : ""}&rdquo;</blockquote>` : '<p class="empty">Objective context retained without a text excerpt.</p>'}<p class="source-url"><b>Source:</b> ${escapeHtml(item.sourceUrl)}</p>${item.destinationUrl ? `<p class="source-url"><b>Destination:</b> ${escapeHtml(item.destinationUrl)}</p>` : ""}</div>${image ? `<figure><img src="${image}" alt="Retained visual evidence"><figcaption>Retained first-party screenshot / crop · ${escapeHtml(item.sourceUrl)}</figcaption></figure>` : ""}</div>`;
  }).join("");
  return `<section class="evidence-group ${tone}"><h4>${escapeHtml(title)}</h4>${cards || '<p class="empty evidence-empty">None retained for this evidence role.</p>'}</section>`;
}

function criticSummary(finding: ReportFinding) {
  if (!finding.criticReview) return { decision: finding.status.replaceAll("_", " "), detail: "No optional critic was requested." };
  const result = jsonRecord(finding.criticReview.result);
  const recommendation = typeof result.recommendation === "string" ? result.recommendation.replaceAll("_", " ") : finding.criticReview.status.replaceAll("_", " ");
  const explanation = typeof result.explanation === "string" ? result.explanation : `Optional critic ${finding.criticReview.status.toLowerCase().replaceAll("_", " ")}.`;
  return { decision: recommendation, detail: explanation };
}

export function aiScanReportHtml(scan: AiScanReportData, imageData = new Map<string, string>(), generatedAt = new Date()) {
  const coverage = jsonRecord(scan.coverage);
  const usage = jsonRecord(scan.usage);
  const scoreBreakdown = jsonRecord(scan.scoreBreakdown);
  const pagesOpened = stringArray(coverage.pagesOpened);
  const pagesVisuallyReviewed = stringArray(coverage.pagesVisuallyReviewed);
  const urlsDiscovered = stringArray(coverage.urlsDiscovered);
  const categories = stringArray(coverage.categoriesInspected);
  const documents = stringArray(coverage.documentsInspected);
  const checkoutStates = stringArray(coverage.checkoutStatesInspected);
  const observations = Array.isArray(scan.observations) ? scan.observations.map(jsonRecord) : [];
  const limitations = stringArray(scan.limitations);
  const findings = [...scan.findings].sort((left, right) => (severityRank[left.severity] ?? 9) - (severityRank[right.severity] ?? 9) || left.createdAt.getTime() - right.createdAt.getTime());
  const activeFindings = findings.filter((finding) => activeFindingStatuses.has(finding.status));
  const state = scoreState(scan.score, scan.status);
  const scoreDisplay = scan.score === null ? "—" : String(scan.score);
  const riskDeduction = finiteNumber(scoreBreakdown.riskDeduction);
  const uncertaintyReservation = finiteNumber(scoreBreakdown.uncertaintyReservation);
  const formulaVersion = typeof scoreBreakdown.formulaVersion === "string" ? scoreBreakdown.formulaVersion : "ai-scanner-score-v1";
  const severityCounts = findings.reduce<Record<string, number>>((result, finding) => ({ ...result, [finding.severity]: (result[finding.severity] ?? 0) + 1 }), {});
  const visualEvidenceCount = new Set(findings.flatMap((finding) => finding.evidence.filter((link) => imageData.has(link.evidenceId)).map((link) => link.evidenceId))).size;

  const themeMap = new Map<string, { severity: string; findings: number; evidence: Set<string>; mitigating: Set<string>; pages: Set<string> }>();
  for (const finding of findings) {
    const key = finding.theme.trim() || finding.category;
    const current = themeMap.get(key) ?? { severity: finding.severity, findings: 0, evidence: new Set<string>(), mitigating: new Set<string>(), pages: new Set<string>() };
    if ((severityRank[finding.severity] ?? 9) < (severityRank[current.severity] ?? 9)) current.severity = finding.severity;
    current.findings++;
    current.pages.add(finding.affectedUrl);
    finding.evidence.forEach((link) => {
      current.evidence.add(link.evidenceId);
      if (link.role === "MITIGATING") current.mitigating.add(link.evidenceId);
    });
    themeMap.set(key, current);
  }
  const themeRows = [...themeMap.entries()].sort(([, left], [, right]) => (severityRank[left.severity] ?? 9) - (severityRank[right.severity] ?? 9)).map(([theme, item]) => `<tr><td><b>${escapeHtml(theme)}</b></td><td><span class="severity ${item.severity.toLowerCase()}">${escapeHtml(item.severity)}</span></td><td>${item.findings}</td><td>${item.evidence.size}</td><td>${item.mitigating.size}</td><td>${item.pages.size}</td></tr>`).join("") || '<tr><td colspan="6">No validated risk theme was produced from the retained evidence.</td></tr>';
  const categoryMap = new Map<string, { severity: string; findings: number }>();
  findings.forEach((finding) => {
    const current = categoryMap.get(finding.category) ?? { severity: finding.severity, findings: 0 };
    if ((severityRank[finding.severity] ?? 9) < (severityRank[current.severity] ?? 9)) current.severity = finding.severity;
    current.findings++;
    categoryMap.set(finding.category, current);
  });
  const categoryCards = [...categoryMap.entries()].sort(([, left], [, right]) => (severityRank[left.severity] ?? 9) - (severityRank[right.severity] ?? 9)).slice(0, 4).map(([category, item]) => `<div class="category-card"><label>Assessment category</label><b>${escapeHtml(category)}</b><small>${item.findings} finding${item.findings === 1 ? "" : "s"} · ${escapeHtml(item.severity)} maximum severity</small></div>`).join("") || '<div class="category-card clean"><label>Assessment categories</label><b>No validated risk category</b><small>Retained evidence produced no categorized finding.</small></div>';

  const productRows = scan.products.map((product) => {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const productCategories = stringArray(product.categories);
    return `<tr><td><b>${escapeHtml(product.name)}</b><small>${escapeHtml(productCategories.join(" · ") || "No category retained")}</small></td><td class="sku">${escapeHtml(product.sku ?? "Not observed")}</td><td>${escapeHtml([product.price, product.currency].filter(Boolean).join(" ") || "Not observed")}</td><td>${variants.length}</td><td class="canonical-url">${escapeHtml(product.canonicalUrl)}</td></tr>`;
  }).join("") || '<tr><td colspan="5">No product was objectively verified during this assessment.</td></tr>';

  const policies = deriveAiPolicyCoverage(scan.evidence, scan.status === "COMPLETED");
  const policyRows = policies.map((policy) => {
    const state = policy.inspected ? "INSPECTED" : policy.url ? "LINK OBSERVED" : "NOT OBSERVED";
    const tone = policy.inspected ? "observed" : policy.url ? "linked" : "unobserved";
    return `<tr><td>${escapeHtml(policy.label)}</td><td><span class="policy-status ${tone}">${state}</span></td><td class="canonical-url">${policy.url ? escapeHtml(policy.url) : "No matching public URL was present in retained AI Scanner evidence."}</td></tr>`;
  }).join("");

  const findingPages = findings.map((finding, index) => {
    const adverse = finding.evidence.filter((link) => link.role === "ADVERSE");
    const mitigating = finding.evidence.filter((link) => link.role === "MITIGATING");
    const neutral = finding.evidence.filter((link) => link.role === "NEUTRAL");
    const product = scan.products.find((candidate) => candidate.canonicalUrl === finding.affectedUrl);
    const review = criticSummary(finding);
    const sku = finding.verifiedSku ?? product?.sku ?? "Not observed";
    const canonicalUrl = product?.canonicalUrl ?? finding.affectedUrl;
    return `<section class="finding-page"><div class="finding-head"><div><p class="eyebrow">Finding ${String(index + 1).padStart(2, "0")} of ${String(findings.length).padStart(2, "0")}</p><h2>${escapeHtml(finding.title)}</h2></div><span class="severity-pill ${finding.severity.toLowerCase()}">${escapeHtml(finding.severity)}</span></div><div class="finding-meta"><div><label>Confidence</label><b>${Math.round(finding.confidence * 100)}%</b></div><div><label>Finding status</label><b>${escapeHtml(finding.status.replaceAll("_", " "))}</b></div><div><label>Adjudication / critic</label><b>${escapeHtml(review.decision)}</b></div><div><label>Source</label><b>${escapeHtml(scan.model)} · validated first-party evidence</b></div></div><div class="finding-summary"><p>${escapeHtml(finding.explanation)}</p><div class="identity-grid"><div><label>Affected page / product</label><p>${escapeHtml(finding.affectedProduct ?? product?.name ?? finding.contentType)}</p></div><div><label>Affected category</label><p>${escapeHtml(finding.affectedCategory ?? finding.category)}</p></div><div><label>Verified SKU</label><p class="sku">${escapeHtml(sku)}</p></div><div><label>Exact canonical URL</label><p class="canonical-url">${escapeHtml(canonicalUrl)}</p></div></div></div><div class="finding-grid"><div><label>Why it was flagged</label><p>${escapeHtml(finding.explanation)}</p><small>${escapeHtml(finding.theme)} · ${escapeHtml(finding.category)} · ${escapeHtml(finding.materiality.replaceAll("_", " "))}</small></div><div class="review-note"><label>Adjudication detail</label><p>${escapeHtml(review.detail)}</p></div></div>${evidenceGroup("Adverse Evidence", "adverse", adverse, imageData)}${evidenceGroup("Mitigating Evidence", "mitigating", mitigating, imageData)}${evidenceGroup("Neutral / Supporting Context", "neutral", neutral, imageData)}<div class="remediation"><label>Recommended Remediation</label><p>${escapeHtml(finding.remediation)}</p></div></section>`;
  }).join("") || '<section class="section"><div class="clean-state"><span>✓</span><div><b>No validated findings</b><p>No material finding was produced from the evidence Luna reviewed in this assessment.</p></div></div></section>';

  const assessment = scan.summary ?? (findings.length ? `${findings.length} validated finding${findings.length === 1 ? " was" : "s were"} produced for review.` : "No validated finding was produced from the retained evidence.");
  const observationCards = observations.map((observation) => `<div class="observation"><p>${escapeHtml(observation.text ?? "Validated Luna observation")}</p><small>${Array.isArray(observation.evidenceIds) ? `${observation.evidenceIds.length} cited evidence record${observation.evidenceIds.length === 1 ? "" : "s"}` : "Evidence-backed observation"}</small></div>`).join("") || '<p class="empty">No separate Luna observation was retained.</p>';
  const limitationList = limitations.length ? `<ul>${limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "<p>No explicit model or surface-specific limitation was recorded.</p>";

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; } * { box-sizing: border-box; } html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; background: #fff; color: #17191d; font-family: Arial, Helvetica, sans-serif; font-size: 9.5px; line-height: 1.55; }
    .cover { min-height: 255mm; margin: -13mm; padding: 18mm 18mm 15mm; color: #f0f1ed; background: #090b0f; position: relative; overflow: hidden; page-break-after: always; }
    .cover:after { content: ""; position: absolute; width: 156mm; height: 156mm; border: 1px solid #343662; border-radius: 50%; right: -68mm; top: 32mm; box-shadow: 0 0 0 28mm rgba(119,122,234,.035), 0 0 0 56mm rgba(119,122,234,.018); }
    .brand { display: flex; align-items: center; gap: 10px; letter-spacing: 4px; font-size: 11px; font-weight: 700; position: relative; z-index: 2; }
    .brand-mark { width: 24px; height: 24px; border: 1.5px solid #8b8df2; border-radius: 50%; position: relative; } .brand-mark:after { content: ""; position: absolute; width: 4px; height: 4px; background: #a3a5ff; border-radius: 50%; top: -2px; left: 9px; }
    .product-name { color: #6e727c; font-weight: 400; letter-spacing: 2px; }
    .eyebrow { color: #898bf1; letter-spacing: 2.2px; font-size: 7.5px; font-weight: 700; text-transform: uppercase; }
    .cover-main { position: relative; z-index: 1; margin-top: 59mm; max-width: 142mm; } .cover h1 { margin: 8px 0 0; font-size: 34px; line-height: 1.02; letter-spacing: -1.5px; font-weight: 500; }
    .cover-copy { margin-top: 13px; color: #979ba5; font-size: 12px; max-width: 112mm; }
    .cover-score { display: grid; grid-template-columns: 48mm 1fr; align-items: end; gap: 12mm; margin-top: 24mm; padding-top: 9mm; border-top: 1px solid #252830; }
    .score-number { font-size: 60px; line-height: .85; font-weight: 400; letter-spacing: -4px; } .score-number small { font-size: 14px; color: #707580; letter-spacing: 0; }
    .score-label { font-size: 15px; color: #e1e2de; } .score-note { margin-top: 5px; color: #6f747e; font-size: 8.5px; }
    .cover-foot { position: absolute; z-index: 1; left: 18mm; right: 18mm; bottom: 16mm; display: grid; grid-template-columns: repeat(3, 1fr); padding-top: 7mm; border-top: 1px solid #252830; gap: 7mm; }
    label, .cover-foot label { display: block; color: #676c76; font-size: 7px; letter-spacing: 1.1px; text-transform: uppercase; } .cover-foot b { display: block; margin-top: 4px; color: #c8cac5; font-size: 8.5px; font-weight: 400; word-break: break-word; }
    .page { padding-top: 2mm; } .section { margin-bottom: 10mm; } .section.page-break, .finding-page, .method-page { page-break-before: always; }
    .section-head, .finding-head { display: flex; align-items: end; justify-content: space-between; border-bottom: 1px solid #dfe1e5; padding-bottom: 3mm; margin-bottom: 5mm; gap: 8mm; }
    h2 { margin: 0; font-size: 18px; line-height: 1.2; letter-spacing: -.5px; font-weight: 500; } h3 { margin: 0; font-size: 13px; font-weight: 500; } h4 { margin: 0 0 3mm; font-size: 8px; letter-spacing: 1.1px; text-transform: uppercase; }
    .section-no { color: #8588ee; font-size: 8px; letter-spacing: 1.5px; white-space: nowrap; } .lead { color: #444850; font-size: 11px; line-height: 1.7; max-width: 170mm; }
    .assessment-grid { display: grid; grid-template-columns: 1.15fr .85fr; gap: 8mm; margin-top: 7mm; } .observation { padding: 3mm 0; border-top: 1px solid #e3e5e8; } .observation p { margin: 0; color: #3d4148; } .observation small { color: #858a93; }
    .score-cards { display: grid; grid-template-columns: repeat(2, 1fr); border: 1px solid #dfe1e5; } .score-card { min-height: 24mm; padding: 4mm; border-right: 1px solid #dfe1e5; border-bottom: 1px solid #dfe1e5; } .score-card:nth-child(even) { border-right: 0; } .score-card:nth-last-child(-n+2) { border-bottom: 0; } .score-card b { display: block; margin-top: 3mm; font-size: 20px; font-weight: 500; } .score-card small { color: #777c85; }
    .signal-grid { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #dfe1e5; margin: 5mm 0; } .signal { min-height: 19mm; padding: 4mm; border-right: 1px solid #dfe1e5; } .signal:last-child { border: 0; } .signal b { display: block; font-size: 18px; font-weight: 500; } .signal span { color: #777c85; font-size: 8px; }
    .category-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin: 0 0 5mm; break-inside: avoid; } .category-card { min-height: 24mm; padding: 4mm; border: 1px solid #dfe1e5; background: #fafafd; } .category-card b { display: block; margin-top: 2mm; color: #31343b; font-size: 10px; font-weight: 500; } .category-card small { display: block; margin-top: 2mm; color: #7b8089; } .category-card.clean { grid-column: 1 / -1; }
    table { width: 100%; border-collapse: collapse; } th { color: #787d86; font-size: 6.8px; letter-spacing: .9px; text-align: left; padding: 2.5mm; border-bottom: 1px solid #dfe1e5; } td { padding: 3mm 2.5mm; border-bottom: 1px solid #eceef0; vertical-align: top; } td small { display: block; margin-top: 1mm; color: #858a92; } .canonical-url { word-break: break-all; color: #50556a; } .sku { font-family: "Courier New", monospace; }
    .severity, .severity-pill { font-weight: 700; letter-spacing: .7px; } .critical, .high { color: #a74646; } .medium { color: #9b7029; } .low { color: #4e699a; } .info { color: #626874; }
    .severity-pill { padding: 2mm 3mm; border: 1px solid currentColor; font-size: 7px; } .policy-status { font-size: 7px; letter-spacing: .8px; } .policy-status.observed { color: #247356; } .policy-status.linked { color: #50649b; } .policy-status.unobserved { color: #8b6e36; }
    .finding-page { padding-top: 2mm; } .finding-head { align-items: start; } .finding-head .eyebrow { margin: 0 0 2mm; }
    .finding-meta { display: grid; grid-template-columns: .65fr 1fr 1fr 1.65fr; border: 1px solid #dfe1e5; margin-bottom: 5mm; } .finding-meta > div { padding: 3mm; border-right: 1px solid #dfe1e5; } .finding-meta > div:last-child { border: 0; } .finding-meta b { display: block; margin-top: 2mm; font-size: 8.5px; font-weight: 500; }
    .finding-summary { padding: 5mm; color: #f1f2ee; background: #111318; } .finding-summary > p { margin: 0; font-size: 11px; line-height: 1.65; } .identity-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm 8mm; margin-top: 5mm; padding-top: 4mm; border-top: 1px solid #2b2e36; } .identity-grid label { color: #777d89; } .identity-grid p { margin: 1mm 0 0; color: #c9cbc6; }
    .finding-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin-top: 5mm; } .finding-grid > div { border-top: 1px solid #dfe1e5; padding-top: 3mm; } .finding-grid p { margin: 2mm 0 0; color: #555a63; } .finding-grid small { display: block; margin-top: 2mm; color: #898e97; } .review-note { padding: 3mm; border: 1px solid #e1e2e6 !important; background: #f7f7f9; }
    .evidence-group { margin-top: 6mm; } .evidence-group h4 { padding-bottom: 2mm; border-bottom: 2px solid #8588e5; color: #62677a; break-after: avoid; page-break-after: avoid; } .evidence-group.adverse h4 { color: #a74646; border-color: #c16b6b; } .evidence-group.mitigating h4 { color: #247356; border-color: #57a183; } .evidence-group.neutral h4 { color: #59647e; border-color: #8790aa; }
    .evidence-card { display: grid; grid-template-columns: 1fr; gap: 4mm; padding: 4mm; margin-top: 3mm; border: 1px solid #e0e2e6; background: #f7f7f9; break-inside: avoid; } .evidence-card.with-visual { grid-template-columns: 1fr 68mm; } .evidence-meta { display: flex; justify-content: space-between; gap: 4mm; color: #858a94; font-size: 7px; letter-spacing: .5px; text-transform: uppercase; } .rationale { margin: 2mm 0; color: #353941; font-weight: 600; }
    blockquote { margin: 2mm 0 0; padding: 3mm 4mm; border-left: 2px solid #8588e5; background: #fff; color: #444850; font-size: 9px; } .source-url { margin: 2mm 0 0; color: #7a7f88; font-size: 7.5px; word-break: break-all; } .evidence-card figure { margin: 0; } .evidence-card img { display: block; width: 100%; max-height: 80mm; object-fit: contain; background: #111318; } .evidence-card figcaption { margin-top: 2mm; color: #7b8089; font-size: 7px; word-break: break-word; }
    .remediation { margin-top: 6mm; padding: 5mm; border: 1px solid #d6d7fa; background: #f7f7ff; break-inside: avoid; } .remediation label { color: #6e71dc; } .remediation p { margin: 2mm 0 0; color: #373b45; font-size: 10.5px; }
    .method-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7mm; } .method-grid > div { border-top: 1px solid #dfe1e5; padding-top: 3mm; } .method-grid b { font-size: 9px; } .method-grid p { color: #676c74; margin: 2mm 0 0; } .limitations { margin-top: 8mm; padding: 5mm; border: 1px solid #dfe1e5; } .limitations ul { margin: 2mm 0 0; padding-left: 5mm; } .limitations li { margin: 1.5mm 0; }
    .disclaimer { margin-top: 9mm; padding: 5mm; background: #111318; color: #a6a9b0; font-size: 8px; line-height: 1.65; } .empty { color: #888d95; } .evidence-empty { padding: 4mm; background: #f7f7f9; } .clean-state { display: flex; gap: 5mm; padding: 8mm; background: #f2f7f4; border: 1px solid #d7e7dd; } .clean-state > span { color: #237351; font-size: 18px; } .clean-state b { font-size: 13px; } .clean-state p { margin: 2px 0 0; color: #5f6862; }
  </style></head><body>
    <section class="cover"><div class="brand"><span class="brand-mark"></span>ORBIT <span class="product-name">AI SCANNER</span></div><div class="cover-main"><p class="eyebrow">Merchant intelligence report</p><h1>${escapeHtml(scan.merchant.businessName)}</h1><p class="cover-copy">A point-in-time assessment of observed website risk, commercial context, policy surfaces, and review-ready first-party evidence.</p><div class="cover-score"><div class="score-number">${scoreDisplay}<small>/100</small></div><div><div class="score-label">${escapeHtml(state.label)}</div><div class="score-note">ORBIT AI Scanner Health Score · deterministic ${escapeHtml(formulaVersion)}</div></div></div></div><div class="cover-foot"><div><label>Merchant domain</label><b>${escapeHtml(scan.site.hostname)}</b></div><div><label>Assessment date</label><b>${escapeHtml(formatDate(scan.completedAt ?? scan.createdAt))}</b></div><div><label>Report generated</label><b>${escapeHtml(formatDate(generatedAt))}</b></div></div></section>
    <main class="page"><section class="section"><div class="section-head"><h2>Executive assessment</h2><span class="section-no">01</span></div><p class="lead">${escapeHtml(assessment)}</p><div class="assessment-grid"><div><h3>Luna observations</h3>${observationCards}</div><div class="score-cards"><div class="score-card"><label>Health Score</label><b>${scoreDisplay}</b><small>${escapeHtml(state.label)}</small></div><div class="score-card"><label>Validated findings</label><b>${findings.length}</b><small>${activeFindings.length} active for review</small></div><div class="score-card"><label>Risk deduction</label><b>−${riskDeduction.toFixed(2)}</b><small>Validated finding attributes</small></div><div class="score-card"><label>Uncertainty reservation</label><b>−${uncertaintyReservation.toFixed(2)}</b><small>Unknown / limited surfaces</small></div></div></div></section>
    <section class="section"><div class="section-head"><h2>Investigation coverage</h2><span class="section-no">02</span></div><div class="signal-grid"><div class="signal"><b>${urlsDiscovered.length}</b><span>URLs discovered</span></div><div class="signal"><b>${pagesOpened.length}</b><span>Pages opened</span></div><div class="signal"><b>${pagesVisuallyReviewed.length}</b><span>Pages visually reviewed</span></div><div class="signal"><b>${finiteNumber(coverage.visualRegionsInspected)}</b><span>Visual regions inspected</span></div></div><table><thead><tr><th>INVESTIGATION SURFACE</th><th>OBSERVED ACTIVITY</th><th>INVESTIGATION SURFACE</th><th>OBSERVED ACTIVITY</th></tr></thead><tbody><tr><td>Images inspected</td><td>${finiteNumber(coverage.imagesInspected)}</td><td>Categories inspected</td><td>${categories.length}</td></tr><tr><td>Products discovered</td><td>${finiteNumber(coverage.productsDiscovered)}</td><td>Products verified</td><td>${finiteNumber(coverage.productsVerified)}</td></tr><tr><td>Documents inspected</td><td>${documents.length}</td><td>Checkout states inspected</td><td>${checkoutStates.length}</td></tr><tr><td>Luna tool calls</td><td>${finiteNumber(coverage.totalLunaToolCalls, scan.toolCalls)}</td><td>Retained visual evidence</td><td>${visualEvidenceCount}</td></tr><tr><td>Audit runtime</td><td>${escapeHtml(formatDuration(finiteNumber(coverage.auditRuntimeMs, scan.runtimeMs)))}</td><td>Tokens / approximate cost</td><td>${finiteNumber(jsonRecord(coverage.tokenUsage).totalTokens, finiteNumber(usage.totalTokens)).toLocaleString("en-US")} / $${finiteNumber(jsonRecord(coverage.tokenUsage).approximateCostUsd, finiteNumber(usage.approximateCostUsd)).toFixed(4)}</td></tr></tbody></table><p class="lead" style="margin-top:5mm">Coverage reports actual Luna investigation activity. It is not a completeness percentage, and reaching a configured runtime, tool, token, or cost limit never implies full coverage.</p></section>
    <section class="section"><div class="section-head"><h2>Key risk themes</h2><span class="section-no">03</span></div><div class="category-grid">${categoryCards}</div><table><thead><tr><th>THEME</th><th>MAX SEVERITY</th><th>FINDINGS</th><th>EVIDENCE</th><th>MITIGATING</th><th>AFFECTED URLS</th></tr></thead><tbody>${themeRows}</tbody></table></section>
    <section class="section"><div class="section-head"><h2>Products reviewed</h2><span class="section-no">04</span></div><table><thead><tr><th>PRODUCT / CATEGORY</th><th>VERIFIED SKU</th><th>PRICE</th><th>VARIANTS</th><th>EXACT CANONICAL URL</th></tr></thead><tbody>${productRows}</tbody></table></section>
    <section class="section"><div class="section-head"><h2>Policy coverage</h2><span class="section-no">05</span></div><table><thead><tr><th>PUBLIC POLICY SURFACE</th><th>OBSERVED STATE</th><th>RETAINED FIRST-PARTY URL</th></tr></thead><tbody>${policyRows}</tbody></table><p class="lead" style="margin-top:5mm">“Inspected” means the policy URL was itself a source of validated AI Scanner evidence. “Link observed” means only that the URL appeared in retained evidence. Neither state asserts that a policy is complete, legally sufficient, applicable, or unchanged.</p></section>
    <section class="section"><div class="section-head"><h2>Severity summary</h2><span class="section-no">06 · ${findings.length} TOTAL</span></div><div class="signal-grid"><div class="signal"><b>${severityCounts.CRITICAL ?? 0}</b><span>Critical</span></div><div class="signal"><b>${severityCounts.HIGH ?? 0}</b><span>High</span></div><div class="signal"><b>${severityCounts.MEDIUM ?? 0}</b><span>Medium</span></div><div class="signal"><b>${severityCounts.LOW ?? 0}</b><span>Low</span></div></div></section>${findingPages}
    <section class="method-page"><div class="section-head"><h2>Method & limitations</h2><span class="section-no">07</span></div><div class="method-grid"><div><b>Luna-first investigation</b><p>${escapeHtml(scan.model)} independently selected read-only browser tools from the merchant URL. No legacy semantic scanner supplied findings or fallback conclusions.</p></div><div><b>Retained first-party evidence</b><p>Factual assertions must cite validated AI Scanner evidence. Screenshots and crops are retained rendered pixels with their page, destination, text, DOM, and commercial context.</p></div><div><b>Objective validation</b><p>ORBIT validates URLs, evidence references, screenshot IDs, products, canonical URLs, and SKUs without interpreting semantic risk. Luna remains the semantic reviewer.</p></div><div><b>Deterministic Health Score</b><p>Luna does not select the number. ${escapeHtml(formulaVersion)} consumes validated severity, confidence, materiality, prominence, product association, mitigation, and uncertainty.</p></div><div><b>Optional dispute critic</b><p>A second model is used only for configured material disputes. It receives one finding and that finding’s evidence, never the full website.</p></div><div><b>Point-in-time result</b><p>Websites change continuously. This report reflects public surfaces reached during the assessment dated on the cover and may not represent later content or private areas.</p></div></div><div class="limitations"><h3>Recorded limitations</h3>${limitationList}</div><div class="disclaimer">ORBIT provides merchant intelligence and compliance-monitoring software. This report is an informational, evidence-backed screening artifact. It is not legal advice, a compliance certification, or a guarantee of approval or continued service by any third party.</div></section></main>
  </body></html>`;
}
