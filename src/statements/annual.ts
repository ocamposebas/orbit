import PDFDocument from "pdfkit";
import { formatMinor, minorDecimal } from "./calculation";
import { safeCsvCell } from "./csv";

export type AnnualSummary = { currency: string; grossPaymentsMinor: bigint; refundsMinor: bigint; disputesMinor: bigint; processingFeesMinor: bigint; orbitFeesMinor: bigint; adjustmentsMinor: bigint; netActivityMinor: bigint; payoutsMinor: bigint; months: Array<{ periodStart: Date; grossPaymentsMinor: bigint; refundsMinor: bigint; feesMinor: bigint; netActivityMinor: bigint; payoutsMinor: bigint }> };

export function annualSummaryCsv(summary: AnnualSummary, _year: number, timeZone: string) {
  const rows = [["Month", "Gross Volume", "Refunds", "Fees", "Net Activity", "Payouts", "Currency"], ...summary.months.map((month) => [new Intl.DateTimeFormat("en-US", { month: "long", timeZone }).format(month.periodStart), minorDecimal(month.grossPaymentsMinor, summary.currency), minorDecimal(month.refundsMinor, summary.currency), minorDecimal(month.feesMinor, summary.currency), minorDecimal(month.netActivityMinor, summary.currency), minorDecimal(month.payoutsMinor, summary.currency), summary.currency])];
  return `\uFEFF${rows.map((row) => row.map(safeCsvCell).join(",")).join("\r\n")}\r\n`;
}

export function annualSummaryPdf(summary: AnnualSummary, year: number, merchantName: string, timeZone: string) {
  const document = new PDFDocument({ size: "LETTER", margin: 52, info: { Title: `${year} ORBIT Annual Summary`, Author: "ORBIT" } });
  const chunks: Buffer[] = [];
  document.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const complete = new Promise<Buffer>((resolve, reject) => { document.on("end", () => resolve(Buffer.concat(chunks))); document.on("error", reject); });
  document.rect(0, 0, 612, 18).fill("#6557d9"); document.fillColor("#11182f").font("Helvetica-Bold").fontSize(19).text("ORBIT", 52, 52); document.fontSize(30).text(`${year} Annual Summary`, 52, 112); document.fillColor("#667085").font("Helvetica").fontSize(10).text(`${merchantName} · ${summary.currency}`, 52, 153);
  const totals: Array<[string, bigint]> = [["Gross volume", summary.grossPaymentsMinor], ["Refunds", -summary.refundsMinor], ["Disputes", -summary.disputesMinor], ["ORBIT fees", -summary.orbitFeesMinor], ["Processing fees", -summary.processingFeesMinor], ["Adjustments", summary.adjustmentsMinor], ["Net activity", summary.netActivityMinor], ["Total payouts", summary.payoutsMinor]];
  totals.forEach(([label, value], index) => { const y = 205 + index * 30; document.fillColor("#11182f").font(index === 6 ? "Helvetica-Bold" : "Helvetica").fontSize(9).text(label, 64, y); document.font("Helvetica-Bold").text(formatMinor(value, summary.currency), 380, y, { width: 164, align: "right" }); document.moveTo(52, y + 19).lineTo(560, y + 19).strokeColor("#e5e7eb").lineWidth(0.5).stroke(); });
  document.font("Helvetica-Bold").fontSize(14).text("Monthly breakdown", 52, 475); let y = 508; summary.months.forEach((month) => { const label = new Intl.DateTimeFormat("en-US", { month: "short", timeZone }).format(month.periodStart); document.fillColor("#11182f").font("Helvetica").fontSize(8).text(label, 52, y); document.text(formatMinor(month.grossPaymentsMinor, summary.currency), 140, y, { width: 90, align: "right" }); document.text(formatMinor(month.netActivityMinor, summary.currency), 300, y, { width: 100, align: "right" }); document.text(formatMinor(month.payoutsMinor, summary.currency), 460, y, { width: 100, align: "right" }); y += 22; });
  document.fillColor("#737b8b").fontSize(7).text("Provided for reconciliation and recordkeeping. This is not a bank statement or official tax form.", 52, 742, { width: 508, align: "center" }); document.end(); return complete;
}
