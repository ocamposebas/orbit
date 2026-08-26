import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { MONTHLY_SERVICE_FEE_USD, PLATFORM_SERVICE_FEE_PERCENT, STANDARD_STRIPE_PROCESSING_FEE_PERCENT, TOTAL_TRANSFER_FEE_PERCENT } from "./pricing";

export { MONTHLY_SERVICE_FEE_USD, PLATFORM_SERVICE_FEE_PERCENT, STANDARD_STRIPE_PROCESSING_FEE_PERCENT, TOTAL_TRANSFER_FEE_PERCENT } from "./pricing";

type AgreementDocument = {
  id: string;
  termsVersion: string;
  legalName: string | null | undefined;
  tradeName: string | null | undefined;
  entityType: string | null | undefined;
  taxId: string | null | undefined;
  registrationNumber: string | null | undefined;
  businessAddress: string | null | undefined;
  city: string | null | undefined;
  region: string | null | undefined;
  postalCode: string | null | undefined;
  countryCode: string | null | undefined;
  coveredDomains: string | null | undefined;
  primaryContactName: string | null | undefined;
  primaryContactRole: string | null | undefined;
  primaryContactEmail: string | null | undefined;
  primaryContactPhone: string | null | undefined;
  billingDescriptor: string | null | undefined;
  estimatedMonthlyVolume: string | null | undefined;
  averageTransactionAmount: string | null | undefined;
  highestTransactionAmount: string | null | undefined;
  productsAndServices: string | null | undefined;
  informationCertifiedAt: Date | null;
  merchant: { businessName: string; industry: string };
};

const REPRESENTATIVE = "Sebastian Ocampo";

let representativeSignature: string | undefined;
function representativeSignatureDataUrl() {
  if (representativeSignature !== undefined) return representativeSignature;
  try {
    representativeSignature = `data:image/png;base64,${readFileSync(join(process.cwd(), "src", "contracts", "assets", "sebastian-ocampo-signature.png")).toString("base64")}`;
  } catch {
    representativeSignature = "";
  }
  return representativeSignature;
}

function escapeHtml(value: unknown) {
  return String(value ?? "—").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function date(value: Date | null) {
  return value ? new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(value) : "—";
}

function field(label: string, value: unknown) {
  return `<div class="field"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

function section(number: string, title: string, body: string) {
  return `<section><div class="section-head"><span>${number}</span><h2>${escapeHtml(title)}</h2></div>${body}</section>`;
}

export function agreementDocumentHtml(agreement: AgreementDocument) {
  const reference = `ORB-${agreement.id.slice(-10).toUpperCase()}`;
  const certified = date(agreement.informationCertifiedAt);
  const issued = date(new Date());
  const signature = representativeSignatureDataUrl();
  const partyGrid = [
    field("Legal business name", agreement.legalName), field("Trade name", agreement.tradeName),
    field("Entity type", agreement.entityType), field("Tax identifier", agreement.taxId),
    field("Registration number", agreement.registrationNumber), field("Legal country", agreement.countryCode),
    field("Business address", agreement.businessAddress), field("City / region", `${agreement.city ?? "—"}, ${agreement.region ?? "—"} ${agreement.postalCode ?? ""}`),
    field("Covered domains", agreement.coveredDomains), field("Authorized contact", `${agreement.primaryContactName ?? "—"} · ${agreement.primaryContactRole ?? "—"}`),
    field("Contract email", agreement.primaryContactEmail), field("Phone", agreement.primaryContactPhone),
  ].join("");
  const commercialGrid = [
    field("Monthly service fee", `USD ${MONTHLY_SERVICE_FEE_USD.toFixed(2)}`), field("Total transfer fee", `${TOTAL_TRANSFER_FEE_PERCENT.toFixed(1)}% of gross transaction value`),
    field("Billing descriptor", agreement.billingDescriptor), field("Estimated monthly volume", agreement.estimatedMonthlyVolume),
    field("Average transaction", agreement.averageTransactionAmount), field("Highest expected transaction", agreement.highestTransactionAmount),
  ].join("");

  const feeSchedule = `<div class="fee-schedule"><div class="fee-card"><span>Monthly service fee</span><strong><small>USD</small>$${MONTHLY_SERVICE_FEE_USD}</strong><p>Billed monthly in advance for access to ORBIT monitoring, intelligence and agreement services.</p></div><div class="fee-card accent"><span>Total transfer fee</span><strong>${TOTAL_TRANSFER_FEE_PERCENT.toFixed(1)}<small>%</small></strong><p>${PLATFORM_SERVICE_FEE_PERCENT.toFixed(1)}% ORBIT platform service plus ${STANDARD_STRIPE_PROCESSING_FEE_PERCENT.toFixed(1)}% standard Stripe processing on each successful transaction.</p></div></div>`;
  const signatureMarkup = signature ? `<img src="${signature}" alt="Sebastian Ocampo signature">` : `<span class="typed-signature">Sebastian Ocampo</span>`;

  const sections = [
    section("01", "Definitions and B2B nature", `<p>This Participation, Monitoring and Services Agreement (the <b>“Agreement”</b>) is entered into by ORBIT (the <b>“Provider”</b>), represented for this purpose by ${REPRESENTATIVE}, and the business identified on the cover page (the <b>“Merchant”</b>). The Services are offered solely for business purposes. The Merchant represents that it acts in the course of its trade or business and not as a consumer.</p><p><b>“Merchant Content”</b> means websites, products, policies, marketing statements, checkout flows and digital materials under the Merchant's control. <b>“Monitoring”</b> means automated observation and review of publicly accessible signals within the technically available scope. A <b>“Finding”</b> is an evidence-supported signal requiring contextual assessment; it is not, by itself, a legal conclusion.</p>`),
    section("02", "Scope of Services", `<p>Depending on the applicable order or plan, ORBIT may provide: (a) an initial website assessment; (b) discovery and classification of pages, products and policies; (c) change detection and evidence retention; (d) analysis of signals associated with card-network, processor and applicable-policy requirements; (e) reports, internal scores, alerts and remediation recommendations; and (f) separately enabled technical integrations.</p><p>The scope is limited to public content reached by ORBIT systems and information supplied by the Merchant. Private areas, blocked content, non-interpretable images, non-reproducible dynamic states and third-party systems may remain outside the observed scope.</p>`),
    section("03", "Expressly excluded services", `<p>ORBIT is not an acquiring bank, payment processor, payment facilitator, card network, regulator, certification body or law firm. Unless governed by a separate written agreement, ORBIT does not perform KYC/KYB, identity or beneficial-owner verification, MATCH/TMF inquiries, OFAC/PEP/AML screening, background or credit checks, tax validation, PCI DSS audits, penetration testing, chargeback representation, or legal, tax or financial advice.</p><p>Approval, reserve, hold, pricing, suspension and termination decisions belong exclusively to the applicable processor, acquirer or other competent entity.</p>`),
    section("04", "Merchant obligations and representations", `<p>The Merchant shall: (a) provide true, complete and current information; (b) disclose all relevant domains, subdomains, channels and digital assets; (c) maintain clear privacy, terms, refund, shipping and contact policies where applicable; (d) refrain from deceptive, unlawful or unsubstantiated claims; (e) timely implement any corrections it elects to adopt; (f) report material changes to products, ownership, business model, pricing, subscriptions, traffic, compliance, logistics or processing; (g) safeguard credentials; and (h) comply with applicable law, network rules and third-party agreements.</p><p>The Merchant is responsible for agencies, affiliates, influencers, contractors and other parties acting on its behalf. Electronic certification of the intake confirms the submitter's authority and the accuracy of the information provided.</p>`),
    section("05", "Monitoring, Findings and risk measures", `<p>ORBIT may prioritize signals by risk level and issue remediation requests. The Merchant acknowledges that scores are internal prioritization tools, may change as evidence changes and are not certifications. ORBIT may limit or suspend Services for nonpayment, repeated refusal to address material issues, security risk, unlawful content, apparent fraud, regulatory exposure or material breach. When reasonable and no urgent risk exists, ORBIT will provide notice and an opportunity to cure.</p>`),
    section("06", "Fees, billing, term and termination", `${feeSchedule}<p><b>Monthly Service Fee.</b> The Merchant will pay ORBIT a fixed subscription fee of <b>USD $${MONTHLY_SERVICE_FEE_USD.toFixed(2)} per month</b>, billed monthly in advance. Each billing period begins on the service activation date or its monthly anniversary. The monthly fee is earned when the billing period begins and is non-refundable except where mandatory law requires otherwise.</p><p><b>Total Transfer Fee.</b> In addition to the monthly fee, the Merchant will pay a total standard fee equal to <b>${TOTAL_TRANSFER_FEE_PERCENT.toFixed(1)}% of Gross Transaction Value</b> for each successfully processed customer transaction enabled through ORBIT. This total comprises the <b>${PLATFORM_SERVICE_FEE_PERCENT.toFixed(1)}% ORBIT Platform Service Fee</b> and the <b>${STANDARD_STRIPE_PROCESSING_FEE_PERCENT.toFixed(1)}% standard Stripe processing fee</b>. “Gross Transaction Value” means the full customer-facing transaction amount before deductions for fees, taxes, refunds, disputes or chargebacks.</p><p><b>Collection and non-standard charges.</b> The Merchant authorizes ORBIT and its payment partners to calculate, deduct or separately invoice the fees described above. The ${TOTAL_TRANSFER_FEE_PERCENT.toFixed(1)}% total includes the standard ${STANDARD_STRIPE_PROCESSING_FEE_PERCENT.toFixed(1)}% Stripe processing component. Any non-standard or additional processor, acquirer, card-network or banking charges—including international-card, currency-conversion, dispute, chargeback or similar charges—remain the Merchant's responsibility. Taxes imposed on ORBIT fees are additional unless the law requires them to be included.</p><p><b>Uniform pricing and changes.</b> These commercial terms apply to every Merchant under this version of the Agreement. Any exception must be recorded in a written amendment accepted by both parties. ORBIT may change pricing only prospectively after written notice; continued use after the effective date constitutes acceptance where permitted by law.</p><p>Services continue month to month until terminated. Either party may terminate on thirty (30) days' written notice, while ORBIT may suspend or terminate sooner for nonpayment, unlawful activity, security risk or material breach. Termination does not eliminate fees already earned, accrued obligations or provisions intended to survive.</p>`),
    section("07", "No guarantee of approval or outcome", `<p>ORBIT does not guarantee account approval or continuity, the absence of fines, chargebacks or incidents, absolute compliance, uninterrupted availability, or detection of every risk. A favorable result means only that no material signal was observed within the evidence and coverage actually reviewed. The Merchant remains solely responsible for its products, operations, publications and legal compliance.</p>`),
    section("08", "Data, security and confidentiality", `<p>Each party will protect the other party's confidential information using reasonable safeguards and use it only to perform this Agreement. ORBIT may process Merchant Content, limited operational data and evidence to provide, secure and improve the Services, document decisions and satisfy legitimate obligations. ORBIT does not require and must not receive full payment-card numbers, CVV values or banking credentials.</p><p>ORBIT will maintain commercially reasonable administrative, technical and organizational controls. No system is completely secure. A confirmed incident materially affecting the other party's information will be communicated within the period required by applicable law or, where no period applies, without undue delay after confirmation.</p>`),
    section("09", "Retention, intellectual property and publicity", `<p>The Merchant retains ownership of its content and grants ORBIT a limited license to observe, copy and analyze that content to perform the Services and maintain the record. ORBIT retains its software, models, rules, interfaces, methods, templates and documentation. Records may be retained during the relationship and afterward for a period reasonably necessary for audit, security, claims defense and legal obligations, then deleted or anonymized under the applicable policy.</p><p>Neither party may use the other's name or logo for advertising without prior consent, except for operational identification necessary to provide the Services.</p>`),
    section("10", "Liability and indemnification", `<p>To the maximum extent permitted by law, neither party will be liable for indirect, special, punitive, incidental or consequential damages, or loss of profit, opportunity, reputation or data. ORBIT's aggregate liability arising from this Agreement will not exceed fees actually paid by the Merchant to ORBIT during the twelve months preceding the event giving rise to the claim. These limitations do not apply where prohibited by law or to fraud, willful misconduct or gross negligence to the extent such liability cannot be limited.</p><p>The Merchant will defend and indemnify ORBIT against third-party claims arising from the Merchant's products, content, claims, legal noncompliance or breach. ORBIT will indemnify the Merchant against third-party claims directly caused by ORBIT's willful misconduct, gross negligence, Service-related intellectual-property infringement or material breach.</p>`),
    section("11", "Third parties, communications and independent relationship", `<p>ORBIT may use subprocessors and technical integrations subject to appropriate security and confidentiality obligations. When necessary to operate an authorized integration, respond to a lawful request or protect program integrity, ORBIT may share relevant information with processors, acquirers, professional advisers or authorities. Nothing creates a partnership, mandate, agency, employment, fiduciary duty or exclusivity between the parties.</p>`),
    section("12", "Disputes, notices and general terms", `<p>Before initiating a formal claim, the parties will attempt in good faith to resolve the dispute for thirty (30) days after written notice. Governing law, venue and dispute mechanism will be those stated in the applicable service order or the Provider's controlling corporate document in effect when the Services are purchased. This clause does not prevent urgent relief to protect security, confidentiality or intellectual property.</p><p>Notices will be delivered to registered email addresses. If a provision is unenforceable, it will be modified only as necessary and the remaining provisions will remain effective. Neither party is liable for delays beyond its reasonable control. This Agreement, the applicable order, certified intake and incorporated policies form the entire agreement; amendments require written or verifiable electronic acceptance. Merchant assignment requires ORBIT's prior consent; ORBIT may assign in a reorganization or sale if the assignee assumes its obligations.</p>`),
  ].join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
    @page{size:A4;margin:15mm 14mm 19mm}*{box-sizing:border-box}html{print-color-adjust:exact;-webkit-print-color-adjust:exact}body{margin:0;color:#171a20;font:9.6px/1.68 Arial,Helvetica,sans-serif;background:#fff}p{margin:0 0 3.2mm;color:#505661}p b{color:#20242b}.cover{position:relative;height:263mm;display:flex;flex-direction:column;overflow:hidden;break-after:page;background:linear-gradient(145deg,#07090d 0%,#0d1017 56%,#111426 100%);color:#f7f7f3;padding:17mm 18mm 16mm;margin:-15mm -14mm -19mm}.cover:before,.cover:after{content:"";position:absolute;border:1px solid rgba(143,146,255,.18);border-radius:50%}.cover:before{width:155mm;height:155mm;right:-63mm;top:-40mm;box-shadow:0 0 0 18mm rgba(120,123,255,.025),0 0 0 42mm rgba(120,123,255,.018)}.cover:after{width:72mm;height:72mm;right:19mm;top:4mm;border-color:rgba(96,220,191,.12)}.cover-top{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between}.brand{display:flex;align-items:center;font-size:14px;font-weight:700;letter-spacing:3.6px}.brand i{display:inline-block;width:11px;height:11px;border:2px solid #9597ff;border-radius:50%;margin-right:9px;box-shadow:0 0 18px rgba(139,140,255,.4)}.document-chip{border:1px solid rgba(255,255,255,.12);border-radius:99px;padding:2.4mm 4mm;color:#8e949f;font-size:7px;letter-spacing:1.3px;text-transform:uppercase}.hero{position:relative;z-index:1;margin-top:35mm}.eyebrow,.kicker,.section-head span{color:#8f92ff;font-size:7.5px;font-weight:700;letter-spacing:1.75px;text-transform:uppercase}.hero h1{font-size:39px;line-height:1.02;letter-spacing:-1.8px;margin:5mm 0;max-width:158mm;font-weight:500}.hero p{max-width:123mm;color:#a4aab6;font-size:11.5px;line-height:1.7}.cover-pricing{position:relative;z-index:1;display:grid;grid-template-columns:1fr 1fr;gap:3mm;margin-top:17mm;max-width:132mm}.cover-price{padding:5mm;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.035);border-radius:3mm}.cover-price span,.cover-foot span,.field span{display:block;color:#7f8692;font-size:6.8px;letter-spacing:1.05px;text-transform:uppercase}.cover-price b{display:block;margin-top:2mm;font-size:19px;font-weight:500;letter-spacing:-.7px}.cover-price b small{font-size:8px;color:#969ca8;letter-spacing:.5px;margin-right:1.5mm}.cover-foot{position:relative;z-index:1;margin-top:auto;display:grid;grid-template-columns:1.4fr .8fr .9fr;border-top:1px solid rgba(255,255,255,.12);padding-top:5mm;gap:7mm}.cover-foot b{display:block;margin-top:1.8mm;font-size:9px;font-weight:500;color:#e5e6e2}.intro{break-after:page}.intro-top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #dfe2e8;padding-bottom:5mm;margin-bottom:6mm}.intro h1{font-size:27px;line-height:1.08;letter-spacing:-.8px;margin:1.8mm 0 0}.reference{text-align:right;color:#747b86;font:8px/1.6 monospace}.lead{color:#565d68;font-size:10.8px;max-width:165mm}.grid{display:grid;grid-template-columns:1fr 1fr;border-left:1px solid #dfe2e8;border-top:1px solid #dfe2e8;margin-top:6mm}.field{min-height:15mm;padding:3.2mm 3.8mm;border-right:1px solid #dfe2e8;border-bottom:1px solid #dfe2e8;background:#fff}.field b{display:block;margin-top:1.3mm;font-size:9.5px;font-weight:600;word-break:break-word;color:#242932}.subhead{display:flex;align-items:center;justify-content:space-between;margin:7mm 0 -1mm}.subhead h2{font-size:14px;margin:0}.terms-badge{border:1px solid #d8dafd;background:#f4f4ff;border-radius:99px;padding:1.8mm 3mm;color:#6669cf;font-size:7px;font-weight:700;letter-spacing:.8px}.cert{margin-top:5mm;padding:4.5mm 5mm;background:linear-gradient(90deg,#f1f1ff,#f7f8ff);border-left:2px solid #777aea;color:#525865}.cert b{display:block;margin-bottom:1.3mm;color:#252a33}.fee-schedule{display:grid;grid-template-columns:1fr 1fr;gap:3mm;margin:4mm 0 5mm}.fee-card{padding:5mm;border:1px solid #dfe2e8;border-radius:3mm;background:#f7f8fa}.fee-card.accent{border-color:#d5d6ff;background:#f2f2ff}.fee-card>span{display:block;color:#747b86;font-size:7px;font-weight:700;letter-spacing:1px;text-transform:uppercase}.fee-card strong{display:block;margin:2mm 0 1mm;font-size:23px;line-height:1;color:#171a20;letter-spacing:-1px}.fee-card strong small{font-size:8px;color:#686f7a;letter-spacing:.4px;margin:0 1.2mm}.fee-card p{font-size:8px;line-height:1.55;margin:0;color:#6b727d}section{break-inside:avoid;margin-bottom:7.5mm}.section-head{display:flex;align-items:baseline;gap:5mm;border-bottom:1px solid #dfe2e8;padding-bottom:2.4mm;margin-bottom:3.5mm}.section-head h2{font-size:15.5px;letter-spacing:-.4px;margin:0;font-weight:600;color:#1d2128}.signatures{break-before:page}.signature-intro{max-width:166mm;font-size:10.5px}.signature-grid{display:grid;grid-template-columns:1fr 1fr;gap:8mm;margin-top:12mm}.signature-card{position:relative;min-height:78mm;border:1px solid #dfe2e8;border-radius:4mm;padding:6mm;background:#fafbfc;overflow:hidden}.signature-card.provider{border-color:#d7d8ff;background:linear-gradient(145deg,#f8f8ff,#f1f2ff)}.signature-card .role{color:#6e7480;font-size:7px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase}.signature-card h3{font-size:15px;margin:2mm 0 .7mm}.signature-card .title{color:#747b86;font-size:8px}.sign-line{position:absolute;left:6mm;right:6mm;bottom:15mm;border-top:1px solid #252a32;padding-top:2mm;color:#757c87;font-size:7.5px}.signature-mark{height:27mm;margin-top:8mm;display:flex;align-items:center}.signature-mark img{display:block;width:62mm;height:24mm;object-fit:contain;object-position:left center}.typed-signature{font:italic 20px Georgia,serif;color:#1b1f26}.provider-seal{position:absolute;right:5mm;top:5mm;width:13mm;height:13mm;display:grid;place-items:center;border:1px solid #8487eb;border-radius:50%;color:#696ce0;font-size:6px;font-weight:700;letter-spacing:.5px}.notice{margin-top:9mm;padding:5mm 6mm;border-radius:3mm;background:#0e1117;color:#b8bdc6;font-size:7.8px;line-height:1.7}.notice b{color:#fff}.avoid{break-inside:avoid}
  </style></head><body>
    <div class="cover"><div class="cover-top"><div class="brand"><i></i>ORBIT</div><div class="document-chip">Confidential · Master services agreement</div></div><div class="hero"><div class="eyebrow">Contract record · ${escapeHtml(agreement.termsVersion)}</div><h1>Participation,<br>Monitoring &amp;<br>Services Agreement</h1><p>A definitive B2B framework for continuous risk intelligence, commercial monitoring and verifiable operational evidence.</p></div><div class="cover-pricing"><div class="cover-price"><span>Monthly service fee</span><b><small>USD</small>$${MONTHLY_SERVICE_FEE_USD}</b></div><div class="cover-price"><span>Total transfer fee</span><b>${TOTAL_TRANSFER_FEE_PERCENT.toFixed(1)}%</b></div></div><div class="cover-foot"><div><span>Merchant</span><b>${escapeHtml(agreement.legalName)}</b></div><div><span>Reference</span><b>${reference}</b></div><div><span>Issued</span><b>${issued}</b></div></div></div>
    <div class="intro"><div class="intro-top"><div><div class="kicker">Parties and certified information</div><h1>${escapeHtml(agreement.legalName)}</h1></div><div class="reference">${reference}<br>${escapeHtml(agreement.termsVersion)}</div></div><p class="lead">This record combines the information certified by the Merchant with ORBIT's uniform commercial terms. The Merchant's authorized representative must review the final document before signing.</p><div class="grid">${partyGrid}</div><div class="subhead"><h2>Commercial profile</h2><span class="terms-badge">USD $${MONTHLY_SERVICE_FEE_USD}/MONTH + ${TOTAL_TRANSFER_FEE_PERCENT.toFixed(1)}% TOTAL</span></div><div class="grid">${commercialGrid}</div><div class="cert"><b>Declared products and services</b>${escapeHtml(agreement.productsAndServices)}</div><div class="cert"><b>Submitter certification</b>The submitter represented that they have authority to bind the Merchant, certified the accuracy and completeness of this information, and consented to the electronic document process on ${certified}.</div></div>
    ${sections}
    <section class="signatures"><div class="section-head"><span>13</span><h2>Acceptance and signatures</h2></div><p class="signature-intro">By signing, each signatory represents that they have sufficient authority to bind the party they represent, has reviewed this Agreement—including the <b>USD $${MONTHLY_SERVICE_FEE_USD.toFixed(2)} monthly fee</b> and <b>${TOTAL_TRANSFER_FEE_PERCENT.toFixed(1)}% total transfer fee (${PLATFORM_SERVICE_FEE_PERCENT.toFixed(1)}% ORBIT + ${STANDARD_STRIPE_PROCESSING_FEE_PERCENT.toFixed(1)}% standard Stripe)</b>—and accepts its terms. Counterpart and electronic signatures have the same effect to the extent permitted by applicable law.</p><div class="signature-grid"><div class="signature-card"><div class="role">For the Merchant</div><h3>${escapeHtml(agreement.primaryContactName)}</h3><div class="title">${escapeHtml(agreement.primaryContactRole)}</div><div class="sign-line">Signature and date</div></div><div class="signature-card provider"><div class="provider-seal">ORBIT</div><div class="role">For ORBIT</div><h3>${REPRESENTATIVE}</h3><div class="title">Authorized representative</div><div class="signature-mark">${signatureMarkup}</div><div class="sign-line">Authorized signature · Applied ${issued}</div></div></div><div class="notice"><b>Integrity record.</b> Generated by ORBIT under reference ${reference}, terms version ${escapeHtml(agreement.termsVersion)}. ORBIT retains the cryptographic hash of the issued file to verify that the signed upload matches this definitive version. Review by qualified legal counsel is recommended before production use in a specific jurisdiction.</div></section>
  </body></html>`;
}

export async function renderAgreementPdf(agreement: AgreementDocument) {
  const configuredExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const systemExecutable = process.platform === "linux" ? ["chromium", "chromium-browser"].map((command) => spawnSync("which", [command], { encoding: "utf8" }).stdout.trim()).find(Boolean) : undefined;
  const browser = await chromium.launch({ headless: true, executablePath: configuredExecutable || systemExecutable || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(agreementDocumentHtml(agreement), { waitUntil: "load" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "15mm", right: "14mm", bottom: "19mm", left: "14mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: '<div style="box-sizing:border-box;width:100%;padding:0 14mm;font:8px Arial;color:#777;display:flex;justify-content:space-between"><span>ORBIT · Confidential agreement</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
    });
  } finally {
    await browser.close();
  }
}

export function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function safeContractFilename(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 70) || "merchant";
}
