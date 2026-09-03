import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDatabase } from "@/sentinel/db";
import { childLogger, serializeErrorForLog } from "@/sentinel/logger";
import { calculateStatementTotals, reconciliationDelta, type StatementLedgerEntry } from "./calculation";
import { renderStatementPdf } from "./pdf";
import { loadAuthoritativeLedger, type CurrencyLedger } from "./source";
import { calendarMonthPeriod, previousCalendarMonth, type StatementPeriod } from "./period";
import { getServerEnv } from "@/sentinel/config";

const log = childLogger({ component: "statements" });
export const STATEMENT_VERSION = 1;

function publicStatementId(period: StatementPeriod) {
  return `ORB-STMT-${period.year}-${String(period.month).padStart(2, "0")}-${randomBytes(5).toString("hex").toUpperCase()}`;
}

function checksum(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)).digest("hex");
}

function databaseErrorCode(error: unknown) { return typeof error === "object" && error !== null && "code" in error ? String(error.code) : null; }

function databaseBytes(buffer: Buffer) {
  const bytes = new Uint8Array(buffer.length);
  bytes.set(buffer);
  return bytes;
}

async function audit(merchant: { id: string; organizationId: string }, statementId: string, action: string, metadata: Record<string, unknown> = {}, actorId?: string, requestId?: string) {
  await getDatabase().auditLog.create({ data: { organizationId: merchant.organizationId, merchantId: merchant.id, actorId, action, targetType: "MerchantStatement", targetId: statementId, metadata: metadata as never, requestId } });
}

async function persistCurrencyStatement(merchant: { id: string; organizationId: string; businessName: string }, period: StatementPeriod, ledger: CurrencyLedger, options: { actorId?: string; requestId?: string; dryRun?: boolean }) {
  const totals = calculateStatementTotals(ledger.openingBalanceMinor, ledger.entries);
  const delta = reconciliationDelta(totals);
  const snapshotChecksum = checksum({ merchantId: merchant.id, period, currency: ledger.currency, totals, entries: ledger.entries, payouts: ledger.payouts, version: STATEMENT_VERSION });
  if (options.dryRun) return { dryRun: true as const, currency: ledger.currency, totals, reconciliationDeltaMinor: delta.toString(), checksum: snapshotChecksum };

  const existing = await getDatabase().merchantStatement.findUnique({ where: { merchantId_periodStart_currency_version: { merchantId: merchant.id, periodStart: period.start, currency: ledger.currency, version: STATEMENT_VERSION } } });
  if (existing) return { dryRun: false as const, statement: existing, existing: true as const };
  const statementId = publicStatementId(period);
  const created = await getDatabase().merchantStatement.create({ data: {
    publicId: statementId, merchantId: merchant.id, periodStart: period.start, periodEnd: period.end, currency: ledger.currency, status: "GENERATING",
    ...totals, checksum: snapshotChecksum, version: STATEMENT_VERSION,
  } }).catch(async (error) => {
    if (databaseErrorCode(error) !== "P2002") throw error;
    return null;
  });
  if (!created) {
    const concurrent = await getDatabase().merchantStatement.findUnique({ where: { merchantId_periodStart_currency_version: { merchantId: merchant.id, periodStart: period.start, currency: ledger.currency, version: STATEMENT_VERSION } } });
    if (!concurrent) throw new Error("STATEMENT_IDEMPOTENCY_CONFLICT");
    return { dryRun: false as const, statement: concurrent, existing: true as const };
  }
  await audit(merchant, created.id, "STATEMENT_GENERATION_STARTED", { publicId: statementId, currency: ledger.currency, periodStart: period.start.toISOString(), periodEnd: period.end.toISOString() }, options.actorId, options.requestId);

  if (delta !== BigInt(0)) {
    const failed = await getDatabase().merchantStatement.update({ where: { id: created.id }, data: { status: "RECONCILIATION_FAILED" } });
    await audit(merchant, created.id, "STATEMENT_RECONCILIATION_FAILED", { deltaMinor: delta.toString() }, options.actorId, options.requestId);
    log.error({ merchantId: merchant.id, statementId: created.id, period: period.start.toISOString(), jobRunId: options.requestId, deltaMinor: delta.toString() }, "Statement reconciliation failed");
    return { dryRun: false as const, statement: failed, existing: false as const };
  }

  await getDatabase().$transaction([
    getDatabase().statementLineItem.createMany({ data: ledger.entries.map((entry) => ({ statementId: created.id, ...entry })) }),
    getDatabase().statementPayout.createMany({ data: ledger.payouts.map((payout) => ({ statementId: created.id, ...payout })) }),
  ]);
  try {
    const pdf = await renderStatementPdf({ publicId: statementId, merchantName: merchant.businessName, periodStart: period.start, periodEnd: period.end, generatedAt: created.generatedAt, currency: ledger.currency, timeZone: getServerEnv().STATEMENT_TIMEZONE, totals, payouts: ledger.payouts });
    const pdfSha256 = createHash("sha256").update(pdf).digest("hex");
    const finalized = await getDatabase().merchantStatement.update({ where: { id: created.id }, data: { status: "FINALIZED", finalizedAt: new Date(), pdfData: databaseBytes(pdf), pdfStorageReference: `database://MerchantStatement/${created.id}/pdfData`, pdfSha256 } });
    await audit(merchant, created.id, "STATEMENT_GENERATED", { pdfSha256 }, options.actorId, options.requestId);
    await audit(merchant, created.id, "STATEMENT_FINALIZED", { checksum: snapshotChecksum, version: STATEMENT_VERSION }, options.actorId, options.requestId);
    log.info({ merchantId: merchant.id, statementId: created.id, period: period.start.toISOString(), jobRunId: options.requestId }, "Statement finalized");
    return { dryRun: false as const, statement: finalized, existing: false as const };
  } catch (error) {
    await getDatabase().merchantStatement.update({ where: { id: created.id }, data: { status: "PDF_FAILED" } });
    log.error({ merchantId: merchant.id, statementId: created.id, period: period.start.toISOString(), jobRunId: options.requestId, error: serializeErrorForLog(error) }, "Statement PDF rendering failed");
    throw error;
  }
}

export async function generateMerchantStatements(input: { merchantId: string; year: number; month: number; dryRun?: boolean; actorId?: string; requestId?: string }) {
  const env = getServerEnv();
  if (!env.STATEMENTS_ENABLED) throw new Error("STATEMENTS_DISABLED");
  const merchant = await getDatabase().merchant.findUnique({ where: { id: input.merchantId }, select: { id: true, organizationId: true, businessName: true } });
  if (!merchant) throw new Error("MERCHANT_NOT_FOUND");
  const period = calendarMonthPeriod(input.year, input.month, env.STATEMENT_TIMEZONE);
  const ledgers = await loadAuthoritativeLedger(merchant.id, period);
  const results = [];
  for (const ledger of ledgers) results.push(await persistCurrencyStatement(merchant, period, ledger, input));
  return { period, results };
}

export async function generatePreviousMonthForEligibleMerchants(now = new Date(), jobRunId = randomUUID()) {
  const env = getServerEnv();
  if (!env.STATEMENTS_ENABLED) return { jobRunId, generated: 0, statements: [] as string[] };
  const period = previousCalendarMonth(now, env.STATEMENT_TIMEZONE);
  const merchants = await getDatabase().merchant.findMany({ where: { status: { in: ["READY", "MONITORED"] }, portalEnabled: true, stripeConnect: { isNot: null } }, select: { id: true } });
  const statements: string[] = [];
  for (const merchant of merchants) {
    try {
      const result = await generateMerchantStatements({ merchantId: merchant.id, year: period.year, month: period.month, requestId: jobRunId });
      statements.push(...result.results.flatMap((item) => "statement" in item && item.statement?.status === "FINALIZED" ? [item.statement.id] : []));
    } catch (error) {
      log.error({ merchantId: merchant.id, period: period.start.toISOString(), jobRunId, error: serializeErrorForLog(error) }, "Statement generation failed");
    }
  }
  return { jobRunId, generated: statements.length, statements };
}

export async function regenerateStatementPdf(statementId: string) {
  const statement = await getDatabase().merchantStatement.findUnique({ where: { id: statementId }, include: { merchant: { select: { businessName: true } }, payouts: true } });
  if (!statement || statement.status !== "FINALIZED") throw new Error("FINALIZED_STATEMENT_NOT_FOUND");
  const totals = { openingBalanceMinor: statement.openingBalanceMinor, grossPaymentsMinor: statement.grossPaymentsMinor, refundsMinor: statement.refundsMinor, disputesMinor: statement.disputesMinor, processingFeesMinor: statement.processingFeesMinor, orbitFeesMinor: statement.orbitFeesMinor, adjustmentsMinor: statement.adjustmentsMinor, netActivityMinor: statement.netActivityMinor, payoutsMinor: statement.payoutsMinor, closingBalanceMinor: statement.closingBalanceMinor, paymentCount: statement.paymentCount, refundCount: statement.refundCount, disputeCount: statement.disputeCount };
  const pdf = await renderStatementPdf({ ...statement, merchantName: statement.merchant.businessName, timeZone: getServerEnv().STATEMENT_TIMEZONE, totals, payouts: statement.payouts.map((payout) => ({ ...payout })) });
  const pdfSha256 = createHash("sha256").update(pdf).digest("hex");
  return getDatabase().merchantStatement.update({ where: { id: statementId }, data: { pdfData: databaseBytes(pdf), pdfSha256, pdfStorageReference: `database://MerchantStatement/${statementId}/pdfData` } });
}

export function statementTotalsFromRecord(statement: { openingBalanceMinor: bigint; grossPaymentsMinor: bigint; refundsMinor: bigint; disputesMinor: bigint; processingFeesMinor: bigint; orbitFeesMinor: bigint; adjustmentsMinor: bigint; netActivityMinor: bigint; payoutsMinor: bigint; closingBalanceMinor: bigint; paymentCount: number; refundCount: number; disputeCount: number }) {
  return { ...statement };
}

export function ledgerEntryFromRecord(entry: StatementLedgerEntry) { return entry; }
