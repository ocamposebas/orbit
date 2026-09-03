import PDFDocument from "pdfkit";
import { formatMinor, type StatementTotals } from "./calculation";
import type { PayoutSnapshot } from "./source";

type PdfInput = { publicId: string; merchantName: string; periodStart: Date; periodEnd: Date; generatedAt: Date; currency: string; timeZone: string; totals: StatementTotals; payouts: PayoutSnapshot[] };

const navy = "#11182f";
const violet = "#6557d9";
const muted = "#697181";
const pale = "#f7f7fa";
const border = "#e7e9ef";
const green = "#168563";
const left = 52;
const width = 508;

function label(document: PDFKit.PDFDocument, value: string, x: number, y: number, options: PDFKit.Mixins.TextOptions = {}) {
  document.fillColor(muted).font("Helvetica-Bold").fontSize(7).text(value.toUpperCase(), x, y, { characterSpacing: 0.9, ...options });
}

function card(document: PDFKit.PDFDocument, x: number, y: number, cardWidth: number, height: number, fill = "#ffffff") {
  document.roundedRect(x, y, cardWidth, height, 9).fillAndStroke(fill, border);
}

function header(document: PDFKit.PDFDocument, input: PdfInput, generated: Intl.DateTimeFormat, section: string) {
  document.rect(0, 0, 612, 8).fill(violet);
  document.fillColor(navy).font("Helvetica-Bold").fontSize(20).text("ORBIT", left, 42);
  document.fillColor(muted).font("Helvetica").fontSize(7).text("PAYMENTS INFRASTRUCTURE", left, 67, { characterSpacing: 1.25 });
  label(document, section, 370, 43, { width: 190, align: "right" });
  document.fillColor(navy).font("Helvetica-Bold").fontSize(8).text(input.publicId, 330, 59, { width: 230, align: "right" });
  document.fillColor(muted).font("Helvetica").fontSize(7).text(`Generated ${generated.format(input.generatedAt)}`, 330, 74, { width: 230, align: "right" });
}

export async function renderStatementPdf(input: PdfInput) {
  const document = new PDFDocument({ size: "LETTER", margin: left, bufferPages: true, info: { Title: `${input.publicId} Monthly Statement`, Author: "ORBIT" } });
  const chunks: Buffer[] = [];
  document.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const complete = new Promise<Buffer>((resolve, reject) => { document.on("end", () => resolve(Buffer.concat(chunks))); document.on("error", reject); });
  const money = (value: bigint) => formatMinor(value, input.currency);
  const fullDate = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: input.timeZone });
  const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: input.timeZone });
  const month = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: input.timeZone });
  const periodEnd = new Date(input.periodEnd.getTime() - 1);

  header(document, input, shortDate, "Monthly statement");
  label(document, "Statement period", left, 112);
  document.fillColor(navy).font("Helvetica-Bold").fontSize(31).text(month.format(input.periodStart), left, 128);
  document.fillColor(muted).font("Helvetica").fontSize(9).text(`${fullDate.format(input.periodStart)} - ${fullDate.format(periodEnd)}`, left, 167);
  document.fillColor(navy).font("Helvetica-Bold").fontSize(11).text(input.merchantName, left, 185, { width });

  document.roundedRect(left, 220, width, 104, 13).fill(navy);
  label(document, "Closing balance", left + 22, 242);
  document.fillColor("#ffffff").font("Helvetica-Bold").fontSize(34).text(money(input.totals.closingBalanceMinor), left + 22, 261, { width: 380 });
  document.fillColor("#aeb5c5").font("Helvetica-Bold").fontSize(8).text(input.currency, 470, 270, { width: 66, align: "right", characterSpacing: 1 });

  card(document, left, 342, width, 72, pale);
  const balanceItems: Array<[string, bigint]> = [["Opening balance", input.totals.openingBalanceMinor], ["Net activity", input.totals.netActivityMinor], ["Payouts", -input.totals.payoutsMinor]];
  balanceItems.forEach(([name, value], index) => {
    const columnWidth = width / 3;
    const x = left + index * columnWidth;
    if (index > 0) document.moveTo(x, 356).lineTo(x, 400).strokeColor(border).lineWidth(0.7).stroke();
    label(document, name, x + 16, 359, { width: columnWidth - 32 });
    document.fillColor(navy).font("Helvetica-Bold").fontSize(14).text(money(value), x + 16, 379, { width: columnWidth - 32 });
  });

  document.fillColor(navy).font("Helvetica-Bold").fontSize(14).text("Period activity", left, 449);
  document.fillColor(muted).font("Helvetica").fontSize(8).text("Finalized financial snapshot", 420, 453, { width: 140, align: "right" });
  const activity: Array<[string, bigint]> = [
    ["Gross payments", input.totals.grossPaymentsMinor],
    ["Refunds", -input.totals.refundsMinor],
    ["Disputes", -input.totals.disputesMinor],
    ["Processing fees", -input.totals.processingFeesMinor],
    ["ORBIT fees", -input.totals.orbitFeesMinor],
    ["Adjustments", input.totals.adjustmentsMinor],
  ];
  const gap = 10;
  const activityWidth = (width - gap * 2) / 3;
  activity.forEach(([name, value], index) => {
    const x = left + (index % 3) * (activityWidth + gap);
    const y = 477 + Math.floor(index / 3) * 67;
    card(document, x, y, activityWidth, 57);
    label(document, name, x + 13, y + 13, { width: activityWidth - 26 });
    document.fillColor(navy).font("Helvetica-Bold").fontSize(12).text(money(value), x + 13, y + 32, { width: activityWidth - 26 });
  });

  document.roundedRect(left, 626, width, 47, 9).fillAndStroke("#f3f1ff", "#ded9ff");
  label(document, "Reconciliation", left + 15, 641);
  document.fillColor(navy).font("Helvetica").fontSize(8).text(`${money(input.totals.openingBalanceMinor)} + ${money(input.totals.netActivityMinor)} - ${money(input.totals.payoutsMinor)} = ${money(input.totals.closingBalanceMinor)}`, left + 115, 640, { width: 300, align: "center" });
  document.fillColor(green).font("Helvetica-Bold").fontSize(7).text("RECONCILED", 465, 641, { width: 78, align: "right", characterSpacing: 0.7 });
  document.fillColor(muted).font("Helvetica").fontSize(7.5).text("This statement is provided for reconciliation and recordkeeping. It is not a bank statement, tax document, or tax advice.", left, 684, { width, align: "center", lineGap: 2 });

  const hasActivityDetail = input.totals.paymentCount > 0 || input.totals.refundCount > 0 || input.totals.disputeCount > 0 || input.payouts.length > 0;
  if (hasActivityDetail) {
    document.addPage();
    header(document, input, shortDate, "Activity detail");
    document.fillColor(navy).font("Helvetica-Bold").fontSize(25).text("Activity and payouts", left, 116);
    document.fillColor(muted).font("Helvetica").fontSize(9).text(`Detailed counts for ${month.format(input.periodStart)}`, left, 150);

    const counts: Array<[string, string]> = [["Successful payments", String(input.totals.paymentCount)], ["Refunds", String(input.totals.refundCount)], ["Disputes", String(input.totals.disputeCount)]];
    counts.forEach(([name, value], index) => {
      const x = left + index * (activityWidth + gap);
      card(document, x, 188, activityWidth, 76, pale);
      label(document, name, x + 14, 204, { width: activityWidth - 28 });
      document.fillColor(navy).font("Helvetica-Bold").fontSize(24).text(value, x + 14, 226, { width: activityWidth - 28 });
    });

    document.fillColor(navy).font("Helvetica-Bold").fontSize(14).text("Payout summary", left, 310);
    document.fillColor(muted).font("Helvetica").fontSize(8).text(`${input.payouts.length} payout${input.payouts.length === 1 ? "" : "s"} - ${money(input.totals.payoutsMinor)} total`, 380, 314, { width: 180, align: "right" });
    document.roundedRect(left, 344, width, 30, 6).fill(navy);
    [["Payout", left + 12, 150], ["Initiated", 222, 100], ["Status", 338, 85], ["Amount", 440, 108]].forEach(([name, x, columnWidth]) => {
      document.fillColor("#cbd0dc").font("Helvetica-Bold").fontSize(7).text(String(name).toUpperCase(), Number(x), 355, { width: Number(columnWidth), align: name === "Amount" ? "right" : "left", characterSpacing: 0.6 });
    });
    let y = 390;
    if (input.payouts.length === 0) {
      document.fillColor(muted).font("Helvetica").fontSize(9).text("No payouts were initiated during this period.", left, y, { width, align: "center" });
    }
    input.payouts.slice(0, 7).forEach((payout) => {
      document.fillColor(navy).font("Helvetica-Bold").fontSize(8).text(payout.externalId, left + 12, y, { width: 150, height: 10, ellipsis: true, lineBreak: false });
      document.fillColor(muted).font("Helvetica").text(shortDate.format(payout.initiatedAt), 222, y, { width: 100, lineBreak: false });
      document.text(payout.status.replaceAll("_", " ").toUpperCase(), 338, y, { width: 85, height: 10, ellipsis: true, lineBreak: false });
      document.fillColor(navy).font("Helvetica-Bold").text(money(payout.amountMinor), 440, y, { width: 108, align: "right", lineBreak: false });
      if (payout.destinationSummary) document.fillColor(muted).font("Helvetica").fontSize(7).text(payout.destinationSummary, left + 12, y + 15, { width: 360, height: 9, ellipsis: true, lineBreak: false });
      document.moveTo(left, y + 31).lineTo(left + width, y + 31).strokeColor(border).lineWidth(0.6).stroke();
      y += 42;
    });
    if (input.payouts.length > 7) {
      document.fillColor(muted).font("Helvetica").fontSize(7).text("Payout details continue on the following page.", left, 690, { width, align: "center" });

      const remainingPayouts = input.payouts.slice(7);
      for (let offset = 0; offset < remainingPayouts.length; offset += 12) {
        const payoutPage = remainingPayouts.slice(offset, offset + 12);
        document.addPage();
        header(document, input, shortDate, "Payout detail");
        document.fillColor(navy).font("Helvetica-Bold").fontSize(25).text("Payouts continued", left, 116);
        document.fillColor(muted).font("Helvetica").fontSize(9).text(`${offset + 8}-${offset + 7 + payoutPage.length} of ${input.payouts.length} payouts`, left, 150);
        document.roundedRect(left, 184, width, 30, 6).fill(navy);
        [["Payout", left + 12, 150], ["Initiated", 222, 100], ["Status", 338, 85], ["Amount", 440, 108]].forEach(([name, x, columnWidth]) => {
          document.fillColor("#cbd0dc").font("Helvetica-Bold").fontSize(7).text(String(name).toUpperCase(), Number(x), 195, { width: Number(columnWidth), align: name === "Amount" ? "right" : "left", characterSpacing: 0.6 });
        });
        let payoutY = 230;
        payoutPage.forEach((payout) => {
          document.fillColor(navy).font("Helvetica-Bold").fontSize(8).text(payout.externalId, left + 12, payoutY, { width: 150, height: 10, ellipsis: true, lineBreak: false });
          document.fillColor(muted).font("Helvetica").text(shortDate.format(payout.initiatedAt), 222, payoutY, { width: 100, lineBreak: false });
          document.text(payout.status.replaceAll("_", " ").toUpperCase(), 338, payoutY, { width: 85, height: 10, ellipsis: true, lineBreak: false });
          document.fillColor(navy).font("Helvetica-Bold").text(money(payout.amountMinor), 440, payoutY, { width: 108, align: "right", lineBreak: false });
          if (payout.destinationSummary) document.fillColor(muted).font("Helvetica").fontSize(7).text(payout.destinationSummary, left + 12, payoutY + 14, { width: 360, height: 9, ellipsis: true, lineBreak: false });
          document.moveTo(left, payoutY + 29).lineTo(left + width, payoutY + 29).strokeColor(border).lineWidth(0.6).stroke();
          payoutY += 38;
        });
      }
    }
  }

  const pages = document.bufferedPageRange();
  for (let page = 0; page < pages.count; page += 1) {
    document.switchToPage(page);
    document.moveTo(left, 716).lineTo(left + width, 716).strokeColor(border).lineWidth(0.6).stroke();
    document.fillColor("#8b91a0").font("Helvetica").fontSize(7).text("ORBIT - Payments infrastructure", left, 725, { lineBreak: false });
    document.text(`${input.publicId}   |   ${page + 1} / ${pages.count}`, 320, 725, { width: 240, align: "right", lineBreak: false });
  }
  document.end();
  return complete;
}
