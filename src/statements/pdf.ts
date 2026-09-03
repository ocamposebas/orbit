import PDFDocument from "pdfkit";
import { formatMinor, type StatementTotals } from "./calculation";
import type { PayoutSnapshot } from "./source";

type PdfInput = { publicId: string; merchantName: string; periodStart: Date; periodEnd: Date; generatedAt: Date; currency: string; timeZone: string; totals: StatementTotals; payouts: PayoutSnapshot[] };

const navy = "#11182f";
const violet = "#6557d9";
const muted = "#667085";

export async function renderStatementPdf(input: PdfInput) {
  const document = new PDFDocument({ size: "LETTER", margin: 52, bufferPages: true, info: { Title: `${input.publicId} Monthly Statement`, Author: "ORBIT" } });
  const chunks: Buffer[] = [];
  document.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const complete = new Promise<Buffer>((resolve, reject) => { document.on("end", () => resolve(Buffer.concat(chunks))); document.on("error", reject); });
  const money = (value: bigint) => formatMinor(value, input.currency);
  const label = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: input.timeZone });

  document.rect(0, 0, 612, 18).fill(violet);
  document.fillColor(navy).font("Helvetica-Bold").fontSize(19).text("ORBIT", 52, 48);
  document.fillColor(muted).font("Helvetica").fontSize(8).text("PAYMENTS INFRASTRUCTURE", 52, 72, { characterSpacing: 1.2 });
  document.fillColor(navy).font("Helvetica-Bold").fontSize(30).text("Monthly Statement", 52, 112);
  document.fillColor(muted).fontSize(10).font("Helvetica").text(`${label.format(input.periodStart)} – ${label.format(new Date(input.periodEnd.getTime() - 1))}`, 52, 151);
  document.roundedRect(52, 190, 508, 92, 9).fill("#f4f5f8");
  const metadata = [["MERCHANT", input.merchantName], ["STATEMENT ID", input.publicId], ["GENERATED", label.format(input.generatedAt)], ["STATUS", "FINALIZED"]];
  metadata.forEach(([heading, value], index) => {
    const x = 70 + (index % 2) * 250; const y = 210 + Math.floor(index / 2) * 35;
    document.fillColor(muted).font("Helvetica-Bold").fontSize(7).text(heading, x, y, { characterSpacing: 0.8 });
    document.fillColor(navy).font("Helvetica").fontSize(10).text(value, x, y + 12, { width: 220 });
  });

  document.fillColor(navy).font("Helvetica-Bold").fontSize(15).text("Account summary", 52, 322);
  const summary: Array<[string, bigint, boolean?]> = [
    ["Opening balance", input.totals.openingBalanceMinor], ["Gross payments", input.totals.grossPaymentsMinor], ["Refunds", -input.totals.refundsMinor],
    ["Disputes / chargebacks", -input.totals.disputesMinor], ["Processing fees", -input.totals.processingFeesMinor], ["ORBIT fees", -input.totals.orbitFeesMinor],
    ["Adjustments", input.totals.adjustmentsMinor], ["Net activity", input.totals.netActivityMinor, true], ["Payouts sent", -input.totals.payoutsMinor], ["Closing balance", input.totals.closingBalanceMinor, true],
  ];
  summary.forEach(([name, value, strong], index) => {
    const y = 350 + index * 30;
    if (strong) document.roundedRect(52, y - 7, 508, 27, 5).fill(index === summary.length - 1 ? navy : "#f4f5f8");
    document.fillColor(strong && index === summary.length - 1 ? "#ffffff" : navy).font(strong ? "Helvetica-Bold" : "Helvetica").fontSize(9).text(name, 64, y);
    document.font("Helvetica-Bold").text(money(value), 360, y, { width: 184, align: "right" });
    if (!strong) document.moveTo(52, y + 20).lineTo(560, y + 20).strokeColor("#e5e7eb").lineWidth(0.5).stroke();
  });

  document.addPage();
  document.fillColor(navy).font("Helvetica-Bold").fontSize(18).text("Activity detail", 52, 52);
  document.fillColor(muted).font("Helvetica").fontSize(9).text("The counts and amounts below are retained with this finalized snapshot.", 52, 79);
  const cards: Array<[string, string]> = [["Successful payments", String(input.totals.paymentCount)], ["Refunds", String(input.totals.refundCount)], ["Disputes", String(input.totals.disputeCount)], ["Total payouts", money(input.totals.payoutsMinor)]];
  cards.forEach(([name, value], index) => { const x = 52 + (index % 2) * 258; const y = 112 + Math.floor(index / 2) * 78; document.roundedRect(x, y, 246, 62, 8).fill("#f4f5f8"); document.fillColor(muted).font("Helvetica-Bold").fontSize(7).text(name.toUpperCase(), x + 15, y + 14); document.fillColor(navy).fontSize(17).text(value, x + 15, y + 31); });
  document.fillColor(navy).font("Helvetica-Bold").fontSize(14).text("Payout summary", 52, 295);
  let y = 325;
  if (!input.payouts.length) document.fillColor(muted).font("Helvetica").fontSize(9).text("No payouts were initiated during this period.", 52, y);
  input.payouts.slice(0, 12).forEach((payout) => { document.fillColor(navy).font("Helvetica").fontSize(8).text(payout.externalId, 52, y); document.fillColor(muted).text(label.format(payout.initiatedAt), 210, y); document.text(payout.status.replaceAll("_", " ").toUpperCase(), 330, y); document.fillColor(navy).font("Helvetica-Bold").text(money(payout.amountMinor), 440, y, { width: 120, align: "right" }); document.moveTo(52, y + 17).lineTo(560, y + 17).strokeColor("#e5e7eb").stroke(); y += 27; });
  document.fillColor(muted).font("Helvetica").fontSize(8).text("This statement summarizes payment activity recorded through ORBIT for the stated period. It is not a bank statement and does not constitute tax advice or an official tax form.", 52, 700, { width: 508, align: "center", lineGap: 2 });

  const pages = document.bufferedPageRange();
  for (let page = 0; page < pages.count; page += 1) { document.switchToPage(page); document.fillColor("#8b91a0").font("Helvetica").fontSize(7).text("Generated by ORBIT", 52, 754); document.text(`${page + 1} / ${pages.count}`, 500, 754, { width: 60, align: "right" }); }
  document.end();
  return complete;
}
