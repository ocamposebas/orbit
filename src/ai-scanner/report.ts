import { chromium } from "playwright";
import { getDatabase } from "@/sentinel/db";
import { evidenceStorage } from "@/sentinel/storage";
import type { AuditCoverage } from "./types";

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const list = (items: string[]) => items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "<p>None observed.</p>";

export async function renderAiScanReportPdf(scanId: string) {
  const scan = await getDatabase().aiScan.findUniqueOrThrow({
    where: { id: scanId },
    include: {
      merchant: true,
      site: true,
      products: { orderBy: { createdAt: "desc" } },
      findings: { orderBy: [{ severity: "asc" }, { createdAt: "desc" }], include: { evidence: { include: { evidence: true } }, criticReview: true } },
    },
  });
  const coverage = scan.coverage as unknown as AuditCoverage;
  const observations = Array.isArray(scan.observations) ? scan.observations as Array<{ text?: string; evidenceIds?: string[] }> : [];
  const limitations = Array.isArray(scan.limitations) ? scan.limitations.map(String) : [];
  const visualEvidence = [...new Map(scan.findings.flatMap((finding) => finding.evidence.map((link) => link.evidence)).filter((item) => item.storageKey && item.mimeType?.startsWith("image/")).map((item) => [item.id, item])).values()].slice(0, 16);
  const imageData = new Map<string, string>();
  for (const evidence of visualEvidence) {
    const bytes = evidence.storageKey ? await evidenceStorage().get(evidence.storageKey) : undefined;
    if (bytes?.length) imageData.set(evidence.id, `data:${evidence.mimeType ?? "image/jpeg"};base64,${Buffer.from(bytes).toString("base64")}`);
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:A4;margin:15mm}*{box-sizing:border-box}body{font:10px/1.5 Arial,sans-serif;color:#17191d;margin:0}h1{font-size:24px;margin:4px 0}h2{font-size:14px;margin:22px 0 7px;border-bottom:1px solid #ccd0d7;padding-bottom:4px}h3{font-size:12px;margin:0 0 4px}.muted{color:#646a74}.status{display:inline-block;padding:3px 6px;border:1px solid #afb5bf}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:12px 0}.metric,.card{border:1px solid #d5d8de;padding:8px;break-inside:avoid}.metric b{display:block;font-size:17px}.finding{border-left:4px solid #6973de;margin:10px 0;padding:9px 11px;background:#f5f6f8;break-inside:avoid}.finding.CRITICAL{border-color:#a32f2f}.finding.HIGH{border-color:#bd5c35}.finding.MEDIUM{border-color:#b48b2e}.evidence{margin:5px 0;padding:6px;border:1px solid #d9dce1;background:white}.shot{width:100%;max-height:350px;object-fit:contain;border:1px solid #d4d7dc;margin-top:6px}ul{margin:4px 0;padding-left:18px}a{color:#334cb0;word-break:break-all}.columns{display:grid;grid-template-columns:1fr 1fr;gap:8px}.sku{font-family:monospace}footer{margin-top:24px;border-top:1px solid #ccd0d7;padding-top:6px;color:#70757d}
  </style></head><body>
    <p class="muted">ORBIT AI Scanner v1 · Luna-first merchant audit</p><h1>${escapeHtml(scan.merchant.businessName)}</h1>
    <p>${escapeHtml(scan.merchant.industry)} · ${escapeHtml(scan.merchant.country)} · <a href="${escapeHtml(scan.site.normalizedUrl)}">${escapeHtml(scan.site.normalizedUrl)}</a></p>
    <p><span class="status">${escapeHtml(scan.status)}</span> &nbsp; Score: <b>${scan.score ?? "Not calculated"}</b> / 100 &nbsp; Model: ${escapeHtml(scan.model)}</p>
    <h2>Audit summary</h2><p>${escapeHtml(scan.summary ?? "No completed Luna summary is available.")}</p>
    <div class="metrics">
      <div class="metric"><b>${coverage?.pagesOpened?.length ?? 0}</b>Pages opened</div><div class="metric"><b>${coverage?.pagesVisuallyReviewed?.length ?? 0}</b>Pages visually reviewed</div>
      <div class="metric"><b>${coverage?.visualRegionsInspected ?? 0}</b>Visual regions</div><div class="metric"><b>${coverage?.imagesInspected ?? 0}</b>Images inspected</div>
      <div class="metric"><b>${coverage?.categoriesInspected?.length ?? 0}</b>Categories</div><div class="metric"><b>${coverage?.productsVerified ?? 0}</b>Products verified</div>
      <div class="metric"><b>${coverage?.documentsInspected?.length ?? 0}</b>Documents</div><div class="metric"><b>${coverage?.totalLunaToolCalls ?? scan.toolCalls}</b>Luna tool calls</div>
    </div>
    <p class="muted">Runtime: ${coverage?.auditRuntimeMs ?? scan.runtimeMs} ms · Tokens: ${coverage?.tokenUsage?.totalTokens ?? 0} · Approximate model cost: $${Number(coverage?.tokenUsage?.approximateCostUsd ?? 0).toFixed(4)}. These are actual investigation counters, not a completeness percentage.</p>
    <h2>Luna observations</h2>${observations.length ? observations.map((item) => `<div class="card"><p>${escapeHtml(item.text)}</p><p class="muted">Evidence: ${escapeHtml((item.evidenceIds ?? []).join(", "))}</p></div>`).join("") : "<p>No validated observations were returned.</p>"}
    <h2>Findings</h2>${scan.findings.length ? scan.findings.map((finding) => `<section class="finding ${finding.severity}"><h3>${escapeHtml(finding.title)}</h3><p><b>${finding.severity}</b> · confidence ${(finding.confidence * 100).toFixed(0)}% · ${escapeHtml(finding.theme)} / ${escapeHtml(finding.category)}</p><p>${escapeHtml(finding.explanation)}</p><p><b>Affected URL:</b> <a href="${escapeHtml(finding.affectedUrl)}">${escapeHtml(finding.affectedUrl)}</a></p><div class="columns"><p><b>Product:</b> ${escapeHtml(finding.affectedProduct ?? "Not applicable")}<br><b>Category:</b> ${escapeHtml(finding.affectedCategory ?? "Not applicable")}<br><b>SKU:</b> <span class="sku">${escapeHtml(finding.verifiedSku ?? "Not observed")}</span></p><p><b>Materiality:</b> ${finding.materiality}<br><b>Commercial prominence:</b> ${finding.commercialProminence.toFixed(2)}<br><b>Visual prominence:</b> ${finding.visualProminence.toFixed(2)}</p></div>
      <h3>Adverse evidence</h3>${finding.evidence.filter((item) => item.role === "ADVERSE").map((item) => evidenceHtml(item, imageData)).join("") || "<p>None retained.</p>"}
      <h3>Mitigating evidence</h3>${finding.evidence.filter((item) => item.role === "MITIGATING").map((item) => evidenceHtml(item, imageData)).join("") || "<p>None observed.</p>"}
      <h3>Neutral context</h3>${finding.evidence.filter((item) => item.role === "NEUTRAL").map((item) => evidenceHtml(item, imageData)).join("") || "<p>None observed.</p>"}
      <h3>Specific remediation</h3><p>${escapeHtml(finding.remediation)}</p>${finding.criticReview ? `<p class="muted">Optional critic: ${finding.criticReview.status} · ${escapeHtml(JSON.stringify(finding.criticReview.result))}</p>` : ""}</section>`).join("") : "<p>No validated findings were produced from the retained evidence.</p>"}
    <h2>Verified products</h2>${scan.products.length ? `<table width="100%"><thead><tr><th align="left">Product</th><th align="left">SKU</th><th align="left">Price</th><th align="left">Canonical URL</th></tr></thead><tbody>${scan.products.map((product) => `<tr><td>${escapeHtml(product.name)}</td><td class="sku">${escapeHtml(product.sku ?? "Not observed")}</td><td>${escapeHtml([product.price, product.currency].filter(Boolean).join(" ") || "Not observed")}</td><td><a href="${escapeHtml(product.canonicalUrl)}">${escapeHtml(product.canonicalUrl)}</a></td></tr>`).join("")}</tbody></table>` : "<p>No product was objectively verified during this audit.</p>"}
    <h2>URLs and investigated surfaces</h2><h3>Pages opened</h3>${list(coverage?.pagesOpened ?? [])}<h3>Pages visually reviewed</h3>${list(coverage?.pagesVisuallyReviewed ?? [])}<h3>Documents</h3>${list(coverage?.documentsInspected ?? [])}<h3>Checkout states</h3>${list(coverage?.checkoutStatesInspected ?? [])}
    <h2>Limitations</h2>${list(limitations)}
    <footer>Generated from retained first-party evidence by ORBIT AI Scanner v1. Unknown or unobserved surfaces are not represented as verified.</footer>
  </body></html>`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({ format: "A4", printBackground: true, displayHeaderFooter: false });
  } finally { await browser.close(); }
}

function evidenceHtml(link: { rationale: string | null; evidence: { id: string; sourceUrl: string; kind: string; exactText: string | null } }, images: Map<string, string>) {
  const image = images.get(link.evidence.id);
  return `<div class="evidence"><p><b>${escapeHtml(link.evidence.kind)}</b> · <a href="${escapeHtml(link.evidence.sourceUrl)}">${escapeHtml(link.evidence.sourceUrl)}</a><br>${escapeHtml(link.rationale ?? "")}</p>${link.evidence.exactText ? `<p>${escapeHtml(link.evidence.exactText.slice(0, 2_000))}</p>` : ""}${image ? `<img class="shot" src="${image}">` : ""}<p class="muted">Evidence ID: ${escapeHtml(link.evidence.id)}</p></div>`;
}
