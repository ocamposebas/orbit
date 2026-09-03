import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { calculateStatementTotals, formatMinor, minorDecimal, reconciliationDelta, type StatementLedgerEntry } from "@/statements/calculation";
import { calendarMonthPeriod, monthlyGenerationIsDue, previousCalendarMonth } from "@/statements/period";
import { safeCsvCell, statementCsv } from "@/statements/csv";
import { renderStatementPdf } from "@/statements/pdf";
import { statementEmailHtml } from "@/statements/email";

const entry = (values: Partial<StatementLedgerEntry> & Pick<StatementLedgerEntry, "type" | "amountMinor" | "netMinor">): StatementLedgerEntry => ({ externalId: crypto.randomUUID(), processorType: values.type.toLowerCase(), reportingCategory: values.type.toLowerCase(), processingFeeMinor: BigInt(0), orbitFeeMinor: BigInt(0), occurredAt: new Date("2026-08-15T12:00:00Z"), ...values });

describe("merchant statement calculations", () => {
  it("reconciles payments, fees, refunds, disputes, adjustments and payouts in minor units", () => {
    const totals = calculateStatementTotals(BigInt(10_000), [
      entry({ type: "PAYMENT", amountMinor: BigInt(100_000), processingFeeMinor: BigInt(3_000), orbitFeeMinor: BigInt(3_000), netMinor: BigInt(94_000) }),
      entry({ type: "REFUND", amountMinor: BigInt(-10_000), netMinor: BigInt(-10_000) }),
      entry({ type: "DISPUTE", amountMinor: BigInt(-5_000), netMinor: BigInt(-5_000) }),
      entry({ type: "ADJUSTMENT", amountMinor: BigInt(-250), netMinor: BigInt(-250) }),
      entry({ type: "PAYOUT", amountMinor: BigInt(-50_000), netMinor: BigInt(-50_000) }),
    ]);
    expect(totals).toMatchObject({ grossPaymentsMinor: BigInt(100_000), refundsMinor: BigInt(10_000), disputesMinor: BigInt(5_000), processingFeesMinor: BigInt(3_000), orbitFeesMinor: BigInt(3_000), adjustmentsMinor: BigInt(-250), netActivityMinor: BigInt(78_750), payoutsMinor: BigInt(50_000), closingBalanceMinor: BigInt(38_750), paymentCount: 1, refundCount: 1, disputeCount: 1 });
    expect(reconciliationDelta(totals)).toBe(BigInt(0));
  });

  it("supports zero activity and negative adjustments without floating point", () => {
    expect(calculateStatementTotals(BigInt(125), []).closingBalanceMinor).toBe(BigInt(125));
    const totals = calculateStatementTotals(BigInt(0), [entry({ type: "ADJUSTMENT", amountMinor: BigInt(-99), netMinor: BigInt(-99) })]);
    expect(totals.adjustmentsMinor).toBe(BigInt(-99)); expect(totals.closingBalanceMinor).toBe(BigInt(-99));
  });

  it("keeps currencies independent", () => {
    const usd = calculateStatementTotals(BigInt(0), [entry({ type: "PAYMENT", amountMinor: BigInt(100), netMinor: BigInt(100) })]);
    const eur = calculateStatementTotals(BigInt(0), [entry({ type: "PAYMENT", amountMinor: BigInt(250), netMinor: BigInt(250) })]);
    expect(usd.grossPaymentsMinor).toBe(BigInt(100)); expect(eur.grossPaymentsMinor).toBe(BigInt(250));
  });

  it("formats zero- and three-decimal currencies from ISO minor units", () => {
    expect(formatMinor(BigInt(500), "JPY")).toContain("500");
    expect(minorDecimal(BigInt(1234), "KWD")).toBe("1.234");
  });
});

describe("statement calendar periods", () => {
  it("uses the prior calendar month across year boundaries", () => {
    const period = previousCalendarMonth(new Date("2027-01-01T15:00:00Z"), "America/Chicago");
    expect([period.year, period.month]).toEqual([2026, 12]); expect(period.start.toISOString()).toBe("2026-12-01T06:00:00.000Z"); expect(period.end.toISOString()).toBe("2027-01-01T06:00:00.000Z");
  });
  it("includes February leap days and respects DST offsets", () => {
    const february = calendarMonthPeriod(2028, 2, "America/Chicago");
    expect((february.end.getTime() - february.start.getTime()) / 86_400_000).toBe(29);
    const march = calendarMonthPeriod(2026, 3, "America/Chicago");
    expect((march.end.getTime() - march.start.getTime()) / 3_600_000).toBe(743);
  });
  it("preserves the requested calendar date in positive-offset timezones", () => {
    const period = calendarMonthPeriod(2026, 8, "Asia/Tokyo");
    expect(period.start.toISOString()).toBe("2026-07-31T15:00:00.000Z");
    expect(new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "Asia/Tokyo" }).format(period.start)).toBe("August");
  });
  it("does not schedule before the configured local hour", () => {
    expect(monthlyGenerationIsDue(new Date("2026-09-01T12:59:00Z"), "America/Chicago", 1, 8)).toBe(false);
    expect(monthlyGenerationIsDue(new Date("2026-09-01T13:00:00Z"), "America/Chicago", 1, 8)).toBe(true);
  });
});

describe("statement exports", () => {
  it("neutralizes spreadsheet formulas and escapes CSV", () => {
    expect(safeCsvCell("=HYPERLINK(\"bad\")")).toBe("\"'=HYPERLINK(\"\"bad\"\")\"");
    const csv = statementCsv([entry({ externalId: "tx_1", reference: "@SUM(A1)", type: "PAYMENT", amountMinor: BigInt(100), netMinor: BigInt(100) })], "USD");
    expect(csv).toContain("'@SUM(A1)");
  });
  it("renders a real branded PDF from the finalized snapshot", async () => {
    const totals = calculateStatementTotals(BigInt(0), [entry({ type: "PAYMENT", amountMinor: BigInt(10_000), netMinor: BigInt(10_000) })]);
    const pdf = await renderStatementPdf({ publicId: "ORB-STMT-2026-08-ABC12345", merchantName: "Test Merchant", periodStart: new Date("2026-08-01T00:00:00Z"), periodEnd: new Date("2026-09-01T00:00:00Z"), generatedAt: new Date("2026-09-01T13:00:00Z"), currency: "USD", timeZone: "UTC", totals, payouts: [] });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF"); expect(pdf.length).toBeGreaterThan(2_000);
    expect((await getDocument({ data: new Uint8Array(pdf) }).promise).numPages).toBe(2);
  });
  it("keeps a zero-activity statement to one complete page", async () => {
    const totals = calculateStatementTotals(BigInt(0), []);
    const pdf = await renderStatementPdf({ publicId: "ORB-STMT-2026-08-ZERO0000", merchantName: "Validation Merchant", periodStart: new Date("2026-08-01T00:00:00Z"), periodEnd: new Date("2026-09-01T00:00:00Z"), generatedAt: new Date("2026-09-01T13:00:00Z"), currency: "USD", timeZone: "UTC", totals, payouts: [] });
    expect((await getDocument({ data: new Uint8Array(pdf) }).promise).numPages).toBe(1);
  });
  it("escapes merchant input in the responsive email", () => {
    const html = statementEmailHtml({ merchantName: "<script>alert(1)</script>", period: "August 2026", gross: "$1.00", fees: "$0.00", net: "$1.00", payouts: "$0.00", viewUrl: "https://orbit.example/dashboard/statements/id", pdfUrl: "https://orbit.example/api/pdf" });
    expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;"); expect(html).toContain("not a bank statement");
  });
});
