import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { aiScanReportHtml, type AiScanReportData } from "../src/ai-scanner/report";

const assessedAt = new Date("2026-08-26T15:30:00.000Z");
const productUrl = "https://northstar.example/products/field-lantern-pro";

const evidence = {
  adverse: {
    id: "ev-visual-hero",
    sourceUrl: productUrl,
    destinationUrl: null,
    kind: "VISUAL_REGION",
    exactText: "Built for any environment. Limited warranty details appear below the primary purchase action.",
    storageKey: "sample/hero.png",
    mimeType: "image/svg+xml",
  },
  mitigating: {
    id: "ev-text-warranty",
    sourceUrl: productUrl,
    destinationUrl: "https://northstar.example/warranty",
    kind: "TEXT",
    exactText: "Performance depends on operating conditions. See the limited warranty for coverage and exclusions.",
    storageKey: null,
    mimeType: "text/plain",
  },
  neutral: {
    id: "ev-product-identity",
    sourceUrl: productUrl,
    destinationUrl: null,
    kind: "PRODUCT",
    exactText: "Field Lantern Pro · SKU NSP-FLP-400 · $149.00 USD",
    storageKey: null,
    mimeType: "text/plain",
  },
};

const sample = {
  id: "sample-ai-scan-v1",
  status: "COMPLETED",
  score: 76,
  model: "gpt-5.6-luna",
  summary: "Luna reviewed the public storefront, representative product merchandising, policy links, and retained visual composition. One material representation warrants review; supporting warranty language was also retained and is reflected below.",
  observations: [
    { text: "The primary product claim is visually prominent beside price and purchase controls.", evidenceIds: [evidence.adverse.id] },
    { text: "A qualification and limited-warranty link were visible lower on the same product surface.", evidenceIds: [evidence.mitigating.id] },
  ],
  limitations: [
    "Authenticated account areas and post-payment states were not available.",
    "The assessment reflects public content reachable at the recorded assessment time.",
  ],
  scoreBreakdown: { formulaVersion: "ai-scanner-score-v1", riskDeduction: 19, uncertaintyReservation: 5, deductions: [] },
  coverage: {
    urlsDiscovered: [
      "https://northstar.example/",
      productUrl,
      "https://northstar.example/privacy",
      "https://northstar.example/terms",
      "https://northstar.example/returns",
      "https://northstar.example/shipping",
      "https://northstar.example/contact",
      "https://northstar.example/research-use",
    ],
    pagesOpened: ["https://northstar.example/", productUrl, "https://northstar.example/collections/outdoor-lighting", "https://northstar.example/warranty"],
    pagesVisuallyReviewed: ["https://northstar.example/", productUrl, "https://northstar.example/collections/outdoor-lighting"],
    visualRegionsInspected: 8,
    imagesInspected: 6,
    categoriesInspected: ["Outdoor lighting", "Portable power"],
    productsDiscovered: 14,
    productsVerified: 3,
    documentsInspected: [],
    checkoutStatesInspected: ["https://northstar.example/cart"],
    totalLunaToolCalls: 22,
    auditRuntimeMs: 184_000,
    tokenUsage: { totalTokens: 42_830, approximateCostUsd: 0.0214 },
  },
  usage: { responseCalls: 10, inputTokens: 34_920, outputTokens: 7_910, cachedTokens: 4_100, totalTokens: 42_830, approximateCostUsd: 0.0214 },
  runtimeMs: 184_000,
  toolCalls: 22,
  createdAt: new Date("2026-08-26T15:26:56.000Z"),
  completedAt: assessedAt,
  merchant: { businessName: "Northstar Supply Co.", industry: "Outdoor equipment", country: "US" },
  site: { normalizedUrl: "https://northstar.example/", hostname: "northstar.example" },
  evidence: [{
    id: "ev-navigation",
    sourceUrl: "https://northstar.example/",
    destinationUrl: null,
    metadata: {},
    surroundingDom: {
      links: [
        { href: "https://northstar.example/privacy" },
        { href: "https://northstar.example/terms" },
        { href: "https://northstar.example/returns" },
        { href: "https://northstar.example/shipping" },
        { href: "https://northstar.example/contact" },
        { href: "https://northstar.example/research-use" },
      ],
    },
  }, {
    id: "ev-policy-privacy",
    sourceUrl: "https://northstar.example/privacy",
    destinationUrl: null,
    metadata: {},
    surroundingDom: null,
  }, {
    id: "ev-policy-research-use",
    sourceUrl: "https://northstar.example/research-use",
    destinationUrl: null,
    metadata: {},
    surroundingDom: null,
  }],
  products: [
    { name: "Field Lantern Pro", sku: "NSP-FLP-400", price: "149.00", currency: "USD", canonicalUrl: productUrl, variants: [{ name: "Graphite" }, { name: "Signal Orange" }], categories: ["Outdoor lighting"], createdAt: assessedAt },
    { name: "Trail Lantern Mini", sku: "NSP-TLM-120", price: "69.00", currency: "USD", canonicalUrl: "https://northstar.example/products/trail-lantern-mini", variants: [], categories: ["Outdoor lighting"], createdAt: assessedAt },
    { name: "Basecamp Power Hub", sku: null, price: "229.00", currency: "USD", canonicalUrl: "https://northstar.example/products/basecamp-power-hub", variants: [{ name: "US" }], categories: ["Portable power"], createdAt: assessedAt },
  ],
  findings: [{
    id: "finding-sample-1",
    status: "OPEN",
    criticStatus: "COMPLETED",
    title: "Prominent durability representation needs clearer nearby qualification",
    severity: "HIGH",
    confidence: 0.88,
    theme: "Product performance representation",
    category: "Merchandising",
    explanation: "The retained product-page composition presents an unqualified durability statement beside price and purchase controls, while the available qualification is less prominent and appears farther down the page.",
    affectedUrl: productUrl,
    contentType: "product",
    affectedProduct: "Field Lantern Pro",
    affectedCategory: "Outdoor lighting",
    verifiedSku: "NSP-FLP-400",
    materiality: "MATERIAL",
    commercialProminence: 0.91,
    visualProminence: 0.86,
    remediation: "Place a concise, legible qualification immediately beside the durability statement and primary purchase controls, and link the statement directly to the applicable warranty conditions and exclusions.",
    createdAt: assessedAt,
    criticReview: {
      status: "COMPLETED",
      result: {
        recommendation: "CONFIRM",
        explanation: "The adverse composition remains material after considering the retained warranty qualification; the mitigation narrows but does not remove the presentation concern.",
      },
    },
    evidence: [
      { evidenceId: evidence.adverse.id, role: "ADVERSE", rationale: "Primary rendered product composition and claim prominence.", evidence: evidence.adverse },
      { evidenceId: evidence.mitigating.id, role: "MITIGATING", rationale: "Lower-page warranty qualification retained on the same product surface.", evidence: evidence.mitigating },
      { evidenceId: evidence.neutral.id, role: "NEUTRAL", rationale: "Verified product identity, price, and SKU context.", evidence: evidence.neutral },
    ],
  }],
} as unknown as AiScanReportData;

const visual = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111720"/><stop offset="1" stop-color="#314b57"/></linearGradient><linearGradient id="lamp" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff8ca"/><stop offset="1" stop-color="#f1a73d"/></linearGradient></defs>
  <rect width="1200" height="760" rx="24" fill="#f3f1eb"/><rect x="0" y="0" width="720" height="760" rx="24" fill="url(#bg)"/>
  <circle cx="345" cy="362" r="190" fill="#fff" opacity=".04"/><path d="M265 508h160l-18-265H283z" fill="#252b30" stroke="#93999e" stroke-width="4"/><path d="M286 454h118l-11-184h-96z" fill="url(#lamp)" opacity=".9"/><path d="M300 242q45-110 90 0" fill="none" stroke="#b9bec0" stroke-width="12" stroke-linecap="round"/><rect x="244" y="508" width="202" height="30" rx="15" fill="#15191c"/>
  <text x="770" y="116" font-family="Arial" font-size="18" letter-spacing="3" fill="#777b80">NORTHSTAR SUPPLY CO.</text><text x="770" y="200" font-family="Arial" font-size="46" font-weight="600" fill="#17191d">Field Lantern Pro</text><text x="770" y="254" font-family="Arial" font-size="25" fill="#555960">$149.00 USD</text>
  <text x="770" y="340" font-family="Arial" font-size="31" font-weight="600" fill="#17191d">Built for any environment.</text><text x="770" y="390" font-family="Arial" font-size="19" fill="#656a70">High-output portable illumination</text><text x="770" y="420" font-family="Arial" font-size="19" fill="#656a70">for camp, trail, and emergency use.</text>
  <rect x="770" y="486" width="330" height="66" rx="5" fill="#111318"/><text x="935" y="527" text-anchor="middle" font-family="Arial" font-size="18" font-weight="600" letter-spacing="2" fill="#fff">ADD TO CART</text>
  <text x="770" y="622" font-family="Arial" font-size="14" fill="#8b8f94">Limited warranty terms and operating conditions</text><line x1="770" y1="631" x2="1088" y2="631" stroke="#8b8f94"/>
</svg>`;

const outputDirectory = path.resolve(".artifacts");
const pdfPath = path.join(outputDirectory, "orbit-ai-scanner-v1-sample.pdf");
const coverPath = path.join(outputDirectory, "orbit-ai-scanner-v1-sample-cover.png");
const findingPath = path.join(outputDirectory, "orbit-ai-scanner-v1-sample-finding.png");
await mkdir(outputDirectory, { recursive: true });

const imageData = new Map([[evidence.adverse.id, `data:image/svg+xml;base64,${Buffer.from(visual).toString("base64")}`]]);
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.setContent(aiScanReportHtml(sample, imageData, assessedAt), { waitUntil: "load" });
  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: "13mm", right: "13mm", bottom: "17mm", left: "13mm" },
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: '<div style="box-sizing:border-box;width:100%;padding:0 13mm;font:7px Arial;color:#747984;letter-spacing:.35px;display:flex;justify-content:space-between"><span>ORBIT &middot; AI SCANNER V1 &middot; SAMPLE</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  });
  await page.addStyleTag({ content: ".cover{margin:0!important;width:210mm!important;min-height:297mm!important}.cover-main{margin-top:70mm!important}body{background:#090b0f}" });
  await page.locator(".cover").screenshot({ path: coverPath });

  const findingPage = await browser.newPage({ viewport: { width: 1_000, height: 1_400 } });
  await findingPage.setContent(aiScanReportHtml(sample, imageData, assessedAt), { waitUntil: "load" });
  await findingPage.addStyleTag({ content: "body{background:#e8e9ed;padding:40px}.cover,.page>.section,.method-page{display:none!important}.page{padding:0}.finding-page{page-break-before:auto!important;width:184mm;margin:0 auto;background:#fff;padding:13mm;box-shadow:0 12px 38px rgba(18,20,28,.15)}" });
  await findingPage.locator(".finding-page").screenshot({ path: findingPath });
  await findingPage.close();
} finally {
  await browser.close();
}

console.log(`Sample PDF: ${pdfPath}`);
console.log(`Cover preview: ${coverPath}`);
console.log(`Finding preview: ${findingPath}`);
