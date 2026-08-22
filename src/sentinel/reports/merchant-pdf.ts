import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { getDatabase } from "@/sentinel/db";

const activeStatuses = ["OPEN", "NEEDS_REVIEW", "CONFIRMED", "ACCEPTED_RISK"] as const;
const severityRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function formatDate(value: Date | null | undefined) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(value) + " UTC";
}

function progressNumber(progress: unknown, key: string) {
  if (typeof progress !== "object" || progress === null || Array.isArray(progress)) return 0;
  const value = (progress as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function scoreState(score: number | undefined) {
  if (score === undefined) return { label: "Awaiting assessment", tone: "muted" };
  if (score >= 85) return { label: "Healthy", tone: "good" };
  if (score >= 65) return { label: "Review recommended", tone: "review" };
  return { label: "Attention required", tone: "risk" };
}

export async function loadMerchantReport(merchantId: string, organizationId: string) {
  return getDatabase().merchant.findFirst({
    where: { id: merchantId, organizationId },
    include: {
      sites: { where: { active: true }, take: 1 },
      healthScores: { orderBy: { createdAt: "desc" }, take: 1, include: { components: true, scan: true } },
      findings: {
        where: { status: { in: [...activeStatuses] } },
        orderBy: { lastDetectedAt: "desc" },
        take: 40,
        include: { evidence: { where: { kind: "TEXT" }, orderBy: { createdAt: "asc" }, take: 2 } },
      },
      policies: { orderBy: { type: "asc" } },
      _count: { select: { products: true } },
    },
  });
}

export async function renderMerchantReportPdf(report: NonNullable<Awaited<ReturnType<typeof loadMerchantReport>>>) {
  const html = merchantReportHtml(report);
  const configuredExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const systemExecutable = process.platform === "linux" ? ["chromium", "chromium-browser"].map((command) => spawnSync("which", [command], { encoding: "utf8" }).stdout.trim()).find(Boolean) : undefined;
  const browser = await chromium.launch({ headless: true, executablePath: configuredExecutable || systemExecutable || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "13mm", right: "13mm", bottom: "17mm", left: "13mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: '<div style="box-sizing:border-box;width:100%;padding:0 13mm;font:8px Arial;color:#777;display:flex;justify-content:space-between"><span>ORBIT Sentinel · Confidential</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
    });
  } finally {
    await browser.close();
  }
}

function merchantReportHtml(report: NonNullable<Awaited<ReturnType<typeof loadMerchantReport>>>) {
  const health = report.healthScores[0];
  const scan = health?.scan;
  const score = health?.total;
  const state = scoreState(score);
  const findings = [...report.findings].sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9) || b.lastDetectedAt.getTime() - a.lastDetectedAt.getTime());
  const severityCounts = findings.reduce<Record<string, number>>((counts, finding) => ({ ...counts, [finding.severity]: (counts[finding.severity] ?? 0) + 1 }), {});
  const expectedPolicies = ["TERMS", "PRIVACY", "REFUND", "SHIPPING", "CONTACT"];
  const policyMap = new Map(report.policies.map((policy) => [policy.type, policy]));
  const coverage = progressNumber(scan?.progress, "scanCoveragePercent");
  const certificates = progressNumber(scan?.progress, "certificatesDiscovered");
  const certificatesAnalyzed = progressNumber(scan?.progress, "certificatesAnalyzed");
  const checkout = progressNumber(scan?.progress, "checkoutFlowsInspected");
  const disclaimerPages = progressNumber(scan?.progress, "disclaimerPagesObserved");
  const researchRestrictionPages = progressNumber(scan?.progress, "researchRestrictionPagesObserved");
  const researchCoveredProducts = progressNumber(scan?.progress, "researchCoveredProducts");
  const generatedAt = new Date();
  const scoreDisplay = score === undefined ? "—" : String(score);
  const assessment = findings.length
    ? `${findings.length} evidence-backed observation${findings.length === 1 ? " remains" : "s remain"} open for review.`
    : "No material open finding was produced from the evidence reviewed in the latest completed assessment.";

  const componentRows = health?.components.map((component) => `<div class="component"><div class="component-head"><span>${escapeHtml(component.label)}</span><b>${component.score}</b></div><div class="track"><i style="width:${Math.max(0, Math.min(100, component.score))}%"></i></div></div>`).join("") ?? '<p class="empty">Component scoring will appear after a completed assessment.</p>';
  const policyRows = expectedPolicies.map((type) => {
    const policy = policyMap.get(type as typeof report.policies[number]["type"]);
    const found = policy?.coverage === "FOUND";
    return `<tr><td>${escapeHtml(type.replaceAll("_", " "))}</td><td><span class="status ${found ? "found" : "missing"}">${found ? "FOUND" : "NOT OBSERVED"}</span></td><td>${policy?.url ? escapeHtml(new URL(policy.url).pathname) : "—"}</td></tr>`;
  }).join("");
  const findingRows = findings.length ? findings.map((finding, index) => {
    const evidence = finding.evidence[0];
    return `<article class="finding avoid-break"><div class="finding-index">${String(index + 1).padStart(2, "0")}</div><div><div class="finding-meta"><span class="severity ${finding.severity.toLowerCase()}">${escapeHtml(finding.severity)}</span><span>${Math.round(finding.confidence * 100)}% confidence</span><span>${escapeHtml(finding.status.replaceAll("_", " "))}</span></div><h3>${escapeHtml(finding.title)}</h3><p>${escapeHtml(finding.description)}</p><div class="finding-grid"><div><label>Why it was flagged</label><p>${escapeHtml(finding.reason)}</p></div><div><label>Recommended action</label><p>${escapeHtml(finding.recommendedAction)}</p></div></div>${evidence ? `<blockquote>“${escapeHtml(evidence.evidenceSnippet ?? evidence.normalizedText ?? "Evidence retained from the observed page.")}”<small>${escapeHtml(evidence.pageUrl)}</small></blockquote>` : ""}</div></article>`;
  }).join("") : '<div class="clean-state"><span>✓</span><div><b>No open findings</b><p>No material issue was observed in the evidence reviewed for the latest completed assessment.</p></div></div>';

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; } * { box-sizing: border-box; } html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; background: #fff; color: #17191d; font-family: Arial, Helvetica, sans-serif; font-size: 10px; line-height: 1.5; }
    .cover { min-height: 255mm; margin: -13mm; padding: 18mm 18mm 15mm; color: #f0f1ed; background: #090b0f; position: relative; overflow: hidden; page-break-after: always; }
    .cover:after { content: ""; position: absolute; width: 156mm; height: 156mm; border: 1px solid #343662; border-radius: 50%; right: -68mm; top: 32mm; box-shadow: 0 0 0 28mm rgba(119,122,234,.035), 0 0 0 56mm rgba(119,122,234,.018); }
    .brand { display: flex; align-items: center; gap: 10px; letter-spacing: 4px; font-size: 11px; font-weight: 700; }
    .brand-mark { width: 24px; height: 24px; border: 1.5px solid #8b8df2; border-radius: 50%; position: relative; }
    .brand-mark:after { content: ""; position: absolute; width: 4px; height: 4px; background: #a3a5ff; border-radius: 50%; top: -2px; left: 9px; }
    .eyebrow { color: #898bf1; letter-spacing: 2.2px; font-size: 8px; font-weight: 700; text-transform: uppercase; }
    .cover-main { position: relative; z-index: 1; margin-top: 62mm; max-width: 138mm; }
    h1 { margin: 8px 0 0; font-size: 34px; line-height: 1.02; letter-spacing: -1.5px; font-weight: 500; }
    .cover-copy { margin-top: 13px; color: #979ba5; font-size: 12px; max-width: 105mm; }
    .cover-score { display: grid; grid-template-columns: 45mm 1fr; align-items: end; gap: 12mm; margin-top: 26mm; padding-top: 9mm; border-top: 1px solid #252830; }
    .score-number { font-size: 60px; line-height: .85; font-weight: 400; letter-spacing: -4px; } .score-number small { font-size: 14px; color: #707580; letter-spacing: 0; }
    .score-label { font-size: 15px; color: #e1e2de; } .score-note { margin-top: 5px; color: #6f747e; font-size: 9px; }
    .cover-foot { position: absolute; z-index: 1; left: 18mm; right: 18mm; bottom: 16mm; display: grid; grid-template-columns: repeat(3, 1fr); padding-top: 7mm; border-top: 1px solid #252830; }
    .cover-foot label, .meta label { display: block; color: #616670; font-size: 7px; letter-spacing: 1.2px; text-transform: uppercase; } .cover-foot b { display: block; margin-top: 4px; color: #c8cac5; font-size: 9px; font-weight: 400; }
    .page { padding-top: 2mm; } .section { margin-bottom: 10mm; } .section-head { display: flex; align-items: end; justify-content: space-between; border-bottom: 1px solid #dfe1e5; padding-bottom: 3mm; margin-bottom: 5mm; }
    h2 { margin: 0; font-size: 18px; letter-spacing: -.5px; font-weight: 500; } .section-no { color: #8588ee; font-size: 8px; letter-spacing: 1.5px; }
    .lead { color: #444850; font-size: 11px; line-height: 1.7; max-width: 165mm; }
    .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #dfe1e5; margin: 6mm 0 8mm; } .meta { min-height: 18mm; padding: 4mm; border-right: 1px solid #dfe1e5; } .meta:last-child { border: 0; } .meta b { display: block; margin-top: 3px; font-size: 13px; font-weight: 500; }
    .score-layout { display: grid; grid-template-columns: 45mm 1fr; gap: 10mm; align-items: start; } .score-panel { background: #0d0f13; color: #fff; padding: 8mm; min-height: 48mm; } .score-panel strong { font-size: 40px; line-height: 1; font-weight: 400; } .score-panel p { color: #8f949e; margin: 5px 0 0; }
    .component { margin-bottom: 4mm; } .component-head { display: flex; justify-content: space-between; color: #555a63; } .component-head b { color: #1e2024; } .track { height: 2px; background: #e8e9ec; margin-top: 2mm; } .track i { height: 100%; display: block; background: #7477e5; }
    .signal-grid { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #dfe1e5; margin-top: 6mm; } .signal { padding: 4mm; border-right: 1px solid #dfe1e5; } .signal:last-child { border: 0; } .signal b { display: block; font-size: 18px; font-weight: 500; } .signal span { color: #777c85; font-size: 8px; }
    table { width: 100%; border-collapse: collapse; } th { color: #787d86; font-size: 7px; letter-spacing: 1px; text-align: left; padding: 2.5mm; border-bottom: 1px solid #dfe1e5; } td { padding: 3mm 2.5mm; border-bottom: 1px solid #eceef0; } .status { font-size: 7px; letter-spacing: .8px; } .found { color: #247356; } .missing { color: #9b6f24; }
    .finding { display: grid; grid-template-columns: 10mm 1fr; gap: 5mm; padding: 5mm 0 7mm; border-bottom: 1px solid #dfe1e5; } .finding-index { color: #a1a5ad; font-size: 8px; } .finding-meta { display: flex; gap: 8px; color: #8a8e96; font-size: 7px; letter-spacing: .5px; text-transform: uppercase; } .severity { font-weight: 700; } .critical, .high { color: #a74646; } .medium { color: #9b7029; } .low { color: #4e699a; }
    .finding h3 { margin: 2mm 0 1mm; font-size: 14px; font-weight: 500; } .finding p { margin: 0; color: #5c616a; } .finding-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; margin-top: 4mm; } .finding-grid label { display: block; margin-bottom: 1mm; color: #8588e5; font-size: 7px; letter-spacing: 1px; text-transform: uppercase; }
    blockquote { margin: 4mm 0 0; padding: 3mm 4mm; border-left: 2px solid #8588e5; background: #f5f5f7; color: #444850; font-size: 9px; } blockquote small { display: block; margin-top: 2mm; color: #888d95; word-break: break-all; }
    .clean-state { display: flex; gap: 5mm; padding: 8mm; background: #f2f7f4; border: 1px solid #d7e7dd; } .clean-state > span { color: #237351; font-size: 18px; } .clean-state b { font-size: 13px; } .clean-state p { margin: 2px 0 0; color: #5f6862; }
    .method { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; } .method div { border-top: 1px solid #dfe1e5; padding-top: 3mm; } .method b { font-size: 9px; } .method p { color: #676c74; margin: 2mm 0 0; }
    .disclaimer { margin-top: 9mm; padding: 5mm; background: #111318; color: #a6a9b0; font-size: 8px; line-height: 1.6; } .empty { color: #888d95; }
    .avoid-break { break-inside: avoid; }
  </style></head><body>
    <section class="cover"><div class="brand"><span class="brand-mark"></span>ORBIT <span style="color:#6e727c;font-weight:400;letter-spacing:2px">SENTINEL</span></div><div class="cover-main"><p class="eyebrow">Merchant intelligence report</p><h1>${escapeHtml(report.businessName)}</h1><p class="cover-copy">A point-in-time view of observed website risk, policy coverage and review-ready evidence.</p><div class="cover-score"><div class="score-number">${scoreDisplay}<small>/100</small></div><div><div class="score-label">${escapeHtml(state.label)}</div><div class="score-note">ORBIT internal health score · 0 is weakest, 100 is strongest</div></div></div></div><div class="cover-foot"><div><label>Website</label><b>${escapeHtml(report.sites[0]?.hostname ?? "Not configured")}</b></div><div><label>Assessment completed</label><b>${escapeHtml(formatDate(scan?.completedAt))}</b></div><div><label>Report generated</label><b>${escapeHtml(formatDate(generatedAt))}</b></div></div></section>
    <main class="page"><section class="section"><div class="section-head"><h2>Executive assessment</h2><span class="section-no">01</span></div><p class="lead">${escapeHtml(assessment)} This assessment reflects public evidence successfully reached within the discovered scan boundary and should be interpreted with the coverage notes below.</p><div class="meta-grid"><div class="meta"><label>Pages reviewed</label><b>${scan?.pagesProcessed ?? 0}</b></div><div class="meta"><label>Products mapped</label><b>${scan?.productsDetected ?? report._count.products}</b></div><div class="meta"><label>Open findings</label><b>${findings.length}</b></div><div class="meta"><label>Observed coverage</label><b>${coverage}%</b></div></div><div class="score-layout"><div class="score-panel"><strong>${scoreDisplay}</strong><p>${escapeHtml(state.label)}</p><p>Formula ${escapeHtml(health?.formulaVersion ?? "not calculated")}</p></div><div>${componentRows}</div></div></section>
    <section class="section"><div class="section-head"><h2>Observed surface</h2><span class="section-no">02</span></div><div class="signal-grid"><div class="signal"><b>${scan?.pagesDiscovered ?? 0}</b><span>URLs discovered</span></div><div class="signal"><b>${checkout}</b><span>Public cart / checkout views</span></div><div class="signal"><b>${certificates}</b><span>Certificate links discovered</span></div><div class="signal"><b>${certificatesAnalyzed}</b><span>Certificates deeply analyzed</span></div></div><p class="lead" style="margin-top:5mm">Coverage describes successfully observed public content, not an assertion that every possible URL, image, document, private account area or dynamic state was verified.</p></section>
    <section class="section"><div class="section-head"><h2>Policy coverage</h2><span class="section-no">03</span></div><table><thead><tr><th>POLICY AREA</th><th>OBSERVED STATUS</th><th>PUBLIC PATH</th></tr></thead><tbody>${policyRows}</tbody></table><div class="meta-grid"><div class="meta"><label>Research-use policy</label><b>${policyMap.has("RESEARCH_USE") ? "Observed" : "Not observed"}</b></div><div class="meta"><label>Explicit disclaimer pages</label><b>${disclaimerPages}</b></div><div class="meta"><label>Pages with restrictions</label><b>${researchRestrictionPages}</b></div><div class="meta"><label>Product disclosure coverage</label><b>${researchCoveredProducts}/${scan?.productsDetected ?? 0}</b></div></div><p class="lead">Positive controls are reported as observed evidence, not used as permission to ignore a separate material contradiction. A restriction that merely names a prohibited activity is never treated as promotion.</p></section>
    <section class="section"><div class="section-head"><h2>Open findings</h2><span class="section-no">04 · ${findings.length} TOTAL</span></div><div class="signal-grid" style="margin:0 0 5mm"><div class="signal"><b>${severityCounts.CRITICAL ?? 0}</b><span>Critical</span></div><div class="signal"><b>${severityCounts.HIGH ?? 0}</b><span>High</span></div><div class="signal"><b>${severityCounts.MEDIUM ?? 0}</b><span>Medium</span></div><div class="signal"><b>${severityCounts.LOW ?? 0}</b><span>Low</span></div></div>${findingRows}</section>
    <section class="section"><div class="section-head"><h2>Method & limitations</h2><span class="section-no">05</span></div><div class="method"><div><b>Evidence-led screening</b><p>Findings are produced from retained page evidence, contextual rules and the merchant’s observed public positioning. Confidence indicates strength of the observed signal, not a legal conclusion.</p></div><div><b>Point-in-time result</b><p>Websites change continuously. This report reflects the latest completed assessment shown on the cover and may not describe later changes.</p></div><div><b>Human review</b><p>Open observations should be reviewed in context. Accepted or resolved observations can reappear if the underlying public evidence changes.</p></div><div><b>Internal health score</b><p>The ORBIT Health Score is an internal prioritization measure. It is not a certification, approval decision or score issued by another institution.</p></div></div><div class="disclaimer">ORBIT provides software for compliance monitoring and risk intelligence. This report is informational screening based on observed evidence. It is not legal advice, a compliance certification, or a guarantee of approval or continued service by any third party.</div></section></main>
  </body></html>`;
}
