import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

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
  const partyGrid = [
    field("Legal business name", agreement.legalName), field("Trade name", agreement.tradeName),
    field("Entity type", agreement.entityType), field("Tax identifier", agreement.taxId),
    field("Registration number", agreement.registrationNumber), field("Legal country", agreement.countryCode),
    field("Business address", agreement.businessAddress), field("City / region", `${agreement.city ?? "—"}, ${agreement.region ?? "—"} ${agreement.postalCode ?? ""}`),
    field("Covered domains", agreement.coveredDomains), field("Authorized contact", `${agreement.primaryContactName ?? "—"} · ${agreement.primaryContactRole ?? "—"}`),
    field("Contract email", agreement.primaryContactEmail), field("Phone", agreement.primaryContactPhone),
  ].join("");
  const commercialGrid = [
    field("Billing descriptor", agreement.billingDescriptor), field("Estimated monthly volume", agreement.estimatedMonthlyVolume),
    field("Average transaction", agreement.averageTransactionAmount), field("Highest expected transaction", agreement.highestTransactionAmount),
  ].join("");

  const sections = [
    section("01", "Definitions and B2B nature", `<p>This Participation, Monitoring and Services Agreement (the <b>“Agreement”</b>) is entered into by ORBIT (the <b>“Provider”</b>), represented for this purpose by ${REPRESENTATIVE}, and the business identified on the cover page (the <b>“Merchant”</b>). The Services are offered solely for business purposes. The Merchant represents that it acts in the course of its trade or business and not as a consumer.</p><p><b>“Merchant Content”</b> means websites, products, policies, marketing statements, checkout flows and digital materials under the Merchant's control. <b>“Monitoring”</b> means automated observation and review of publicly accessible signals within the technically available scope. A <b>“Finding”</b> is an evidence-supported signal requiring contextual assessment; it is not, by itself, a legal conclusion.</p>`),
    section("02", "Scope of Services", `<p>Depending on the applicable order or plan, ORBIT may provide: (a) an initial website assessment; (b) discovery and classification of pages, products and policies; (c) change detection and evidence retention; (d) analysis of signals associated with card-network, processor and applicable-policy requirements; (e) reports, internal scores, alerts and remediation recommendations; and (f) separately enabled technical integrations.</p><p>The scope is limited to public content reached by ORBIT systems and information supplied by the Merchant. Private areas, blocked content, non-interpretable images, non-reproducible dynamic states and third-party systems may remain outside the observed scope.</p>`),
    section("03", "Expressly excluded services", `<p>ORBIT is not an acquiring bank, payment processor, payment facilitator, card network, regulator, certification body or law firm. Unless governed by a separate written agreement, ORBIT does not perform KYC/KYB, identity or beneficial-owner verification, MATCH/TMF inquiries, OFAC/PEP/AML screening, background or credit checks, tax validation, PCI DSS audits, penetration testing, chargeback representation, or legal, tax or financial advice.</p><p>Approval, reserve, hold, pricing, suspension and termination decisions belong exclusively to the applicable processor, acquirer or other competent entity.</p>`),
    section("04", "Merchant obligations and representations", `<p>The Merchant shall: (a) provide true, complete and current information; (b) disclose all relevant domains, subdomains, channels and digital assets; (c) maintain clear privacy, terms, refund, shipping and contact policies where applicable; (d) refrain from deceptive, unlawful or unsubstantiated claims; (e) timely implement any corrections it elects to adopt; (f) report material changes to products, ownership, business model, pricing, subscriptions, traffic, compliance, logistics or processing; (g) safeguard credentials; and (h) comply with applicable law, network rules and third-party agreements.</p><p>The Merchant is responsible for agencies, affiliates, influencers, contractors and other parties acting on its behalf. Electronic certification of the intake confirms the submitter's authority and the accuracy of the information provided.</p>`),
    section("05", "Monitoring, Findings and risk measures", `<p>ORBIT may prioritize signals by risk level and issue remediation requests. The Merchant acknowledges that scores are internal prioritization tools, may change as evidence changes and are not certifications. ORBIT may limit or suspend Services for nonpayment, repeated refusal to address material issues, security risk, unlawful content, apparent fraud, regulatory exposure or material breach. When reasonable and no urgent risk exists, ORBIT will provide notice and an opportunity to cure.</p>`),
    section("06", "Fees, term and termination", `<p>Fees, taxes, start date, billing frequency and selected Services will be stated in an accepted service order, proposal or invoice. Unless that document states otherwise, fees for work already begun are non-refundable and subscriptions are billed in advance. Either party may terminate under the notice terms in the applicable order. Termination does not eliminate accrued obligations or provisions intended to survive.</p>`),
    section("07", "No guarantee of approval or outcome", `<p>ORBIT does not guarantee account approval or continuity, the absence of fines, chargebacks or incidents, absolute compliance, uninterrupted availability, or detection of every risk. A favorable result means only that no material signal was observed within the evidence and coverage actually reviewed. The Merchant remains solely responsible for its products, operations, publications and legal compliance.</p>`),
    section("08", "Data, security and confidentiality", `<p>Each party will protect the other party's confidential information using reasonable safeguards and use it only to perform this Agreement. ORBIT may process Merchant Content, limited operational data and evidence to provide, secure and improve the Services, document decisions and satisfy legitimate obligations. ORBIT does not require and must not receive full payment-card numbers, CVV values or banking credentials.</p><p>ORBIT will maintain commercially reasonable administrative, technical and organizational controls. No system is completely secure. A confirmed incident materially affecting the other party's information will be communicated within the period required by applicable law or, where no period applies, without undue delay after confirmation.</p>`),
    section("09", "Retention, intellectual property and publicity", `<p>The Merchant retains ownership of its content and grants ORBIT a limited license to observe, copy and analyze that content to perform the Services and maintain the record. ORBIT retains its software, models, rules, interfaces, methods, templates and documentation. Records may be retained during the relationship and afterward for a period reasonably necessary for audit, security, claims defense and legal obligations, then deleted or anonymized under the applicable policy.</p><p>Neither party may use the other's name or logo for advertising without prior consent, except for operational identification necessary to provide the Services.</p>`),
    section("10", "Liability and indemnification", `<p>To the maximum extent permitted by law, neither party will be liable for indirect, special, punitive, incidental or consequential damages, or loss of profit, opportunity, reputation or data. ORBIT's aggregate liability arising from this Agreement will not exceed fees actually paid by the Merchant to ORBIT during the twelve months preceding the event giving rise to the claim. These limitations do not apply where prohibited by law or to fraud, willful misconduct or gross negligence to the extent such liability cannot be limited.</p><p>The Merchant will defend and indemnify ORBIT against third-party claims arising from the Merchant's products, content, claims, legal noncompliance or breach. ORBIT will indemnify the Merchant against third-party claims directly caused by ORBIT's willful misconduct, gross negligence, Service-related intellectual-property infringement or material breach.</p>`),
    section("11", "Third parties, communications and independent relationship", `<p>ORBIT may use subprocessors and technical integrations subject to appropriate security and confidentiality obligations. When necessary to operate an authorized integration, respond to a lawful request or protect program integrity, ORBIT may share relevant information with processors, acquirers, professional advisers or authorities. Nothing creates a partnership, mandate, agency, employment, fiduciary duty or exclusivity between the parties.</p>`),
    section("12", "Disputes, notices and general terms", `<p>Before initiating a formal claim, the parties will attempt in good faith to resolve the dispute for thirty (30) days after written notice. Governing law, venue and dispute mechanism will be those stated in the applicable service order or the Provider's controlling corporate document in effect when the Services are purchased. This clause does not prevent urgent relief to protect security, confidentiality or intellectual property.</p><p>Notices will be delivered to registered email addresses. If a provision is unenforceable, it will be modified only as necessary and the remaining provisions will remain effective. Neither party is liable for delays beyond its reasonable control. This Agreement, the applicable order, certified intake and incorporated policies form the entire agreement; amendments require written or verifiable electronic acceptance. Merchant assignment requires ORBIT's prior consent; ORBIT may assign in a reorganization or sale if the assignee assumes its obligations.</p>`),
  ].join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
    @page { size:A4; margin:15mm 14mm 19mm; } *{box-sizing:border-box} body{margin:0;color:#17191d;font:10px/1.62 Arial,sans-serif} .cover{height:258mm;display:flex;flex-direction:column;break-after:page;background:#0a0c10;color:#f7f7f3;padding:18mm;margin:-15mm -14mm -19mm} .brand{font-size:14px;font-weight:700;letter-spacing:3px}.brand i{display:inline-block;width:9px;height:9px;border:2px solid #8b8cff;border-radius:50%;margin-right:8px}.hero{margin-top:42mm}.kicker,.section-head span{color:#8b8cff;font-size:8px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase}.hero h1{font-size:37px;line-height:1.04;letter-spacing:-1.5px;margin:5mm 0 5mm;max-width:155mm;font-weight:500}.hero p{max-width:120mm;color:#a4a8b1;font-size:12px}.cover-foot{margin-top:auto;display:grid;grid-template-columns:1.3fr 1fr 1fr;border-top:1px solid #2d3037;padding-top:6mm;gap:7mm}.cover-foot span,.field span{display:block;color:#7e838d;font-size:7px;letter-spacing:1px;text-transform:uppercase}.cover-foot b{display:block;margin-top:2mm;font-size:10px;font-weight:500}.intro{break-after:page}.intro h1{font-size:24px;line-height:1.15;margin:0 0 3mm}.lead{color:#545963;font-size:11px}.grid{display:grid;grid-template-columns:1fr 1fr;border-left:1px solid #dfe1e5;border-top:1px solid #dfe1e5;margin-top:7mm}.field{min-height:16mm;padding:3.5mm;border-right:1px solid #dfe1e5;border-bottom:1px solid #dfe1e5}.field b{display:block;margin-top:1.5mm;font-size:10px;font-weight:500;word-break:break-word}.cert{margin-top:7mm;padding:5mm;background:#f0f0ff;border-left:2px solid #777aea}.cert b{display:block;margin-bottom:1.5mm}section{break-inside:avoid;margin-bottom:8mm}.section-head{display:flex;align-items:baseline;gap:5mm;border-bottom:1px solid #dfe1e5;padding-bottom:2.5mm;margin-bottom:3.5mm}.section-head h2{font-size:16px;letter-spacing:-.35px;margin:0;font-weight:500}p{margin:0 0 3mm;color:#4f545d}p b{color:#25282d}.signatures{break-before:page}.signature-grid{display:grid;grid-template-columns:1fr 1fr;gap:14mm;margin-top:15mm}.signature{border-top:1px solid #202329;padding-top:3mm;min-height:38mm}.signature span{display:block;color:#777c85;margin-top:2mm}.notice{margin-top:10mm;padding:5mm;background:#111318;color:#aeb1b8;font-size:8px}.avoid{break-inside:avoid}
  </style></head><body>
    <div class="cover"><div class="brand"><i></i>ORBIT</div><div class="hero"><div class="kicker">Contract record · ${escapeHtml(agreement.termsVersion)}</div><h1>Participation, Monitoring and Services Agreement</h1><p>A B2B framework for risk intelligence, compliance monitoring and operational evidence.</p></div><div class="cover-foot"><div><span>Merchant</span><b>${escapeHtml(agreement.legalName)}</b></div><div><span>Reference</span><b>${reference}</b></div><div><span>Information certified</span><b>${certified}</b></div></div></div>
    <div class="intro"><div class="kicker">Parties and certified information</div><h1>${escapeHtml(agreement.legalName)}</h1><p class="lead">Information supplied and certified by the Merchant for preparation of this Agreement. A handwritten or electronic signature applied to the downloaded document completes acceptance.</p><div class="grid">${partyGrid}</div><h2 style="margin:8mm 0 0;font-size:15px">Business profile</h2><div class="grid">${commercialGrid}</div><div class="cert"><b>Declared products and services</b>${escapeHtml(agreement.productsAndServices)}</div><div class="cert"><b>Submitter certification</b>The submitter represented that they have authority to bind the Merchant, certified the accuracy and completeness of this information, and consented to the electronic document process on ${certified}.</div></div>
    ${sections}
    <section class="signatures"><div class="section-head"><span>13</span><h2>Acceptance and signatures</h2></div><p>By signing, each signatory represents that they have sufficient authority to bind the party they represent, have read this Agreement and accept its terms. Counterpart and electronic signatures will have the same effect to the extent permitted by applicable law.</p><div class="signature-grid"><div class="signature"><b>FOR THE MERCHANT</b><span>Name: ${escapeHtml(agreement.primaryContactName)}</span><span>Title: ${escapeHtml(agreement.primaryContactRole)}</span><span>Signature:</span><span>Date:</span></div><div class="signature"><b>FOR ORBIT</b><span>Representative: ${REPRESENTATIVE}</span><span>Title: Authorized representative</span><span>Signature:</span><span>Date:</span></div></div><div class="notice">Generated by ORBIT under reference ${reference}. Terms version ${escapeHtml(agreement.termsVersion)}. ORBIT retains the cryptographic hash of the issued file to verify integrity. Review by qualified legal counsel is recommended before production use in a specific jurisdiction.</div></section>
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
