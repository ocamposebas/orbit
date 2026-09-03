import { minorDecimal, type StatementLedgerEntry } from "./calculation";

export function safeCsvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function statementCsv(entries: StatementLedgerEntry[], currency: string) {
  const rows = [["Date", "Payment ID", "Reference", "Type", "Gross", "Processing Fee", "ORBIT Fee", "Refund", "Dispute", "Net", "Currency"]];
  for (const entry of entries) rows.push([
    entry.occurredAt.toISOString(), entry.externalId, entry.reference ?? "", entry.type,
    entry.type === "PAYMENT" ? minorDecimal(entry.amountMinor, currency) : "0", minorDecimal(entry.processingFeeMinor, currency), minorDecimal(entry.orbitFeeMinor, currency),
    entry.type === "REFUND" ? minorDecimal(-entry.amountMinor, currency) : "0", entry.type === "DISPUTE" ? minorDecimal(-entry.amountMinor, currency) : "0", minorDecimal(entry.netMinor, currency), currency.toUpperCase(),
  ]);
  return `\uFEFF${rows.map((row) => row.map(safeCsvCell).join(",")).join("\r\n")}\r\n`;
}
