import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

const mocks = vi.hoisted(() => {
  const state: { statement: Record<string, unknown> | null } = { statement: null };
  const db = {
    merchant: { findUnique: vi.fn(async () => ({ id: "merchant_1", organizationId: "org_1", businessName: "Merchant One" })) },
    merchantStatement: {
      findUnique: vi.fn(async () => state.statement),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { state.statement = { id: "stmt_1", generatedAt: new Date("2026-09-01T13:00:00Z"), finalizedAt: null, emailStatus: "PENDING", ...data }; return state.statement; }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { state.statement = { ...state.statement, ...data }; return state.statement; }),
    },
    statementLineItem: { createMany: vi.fn(async () => ({ count: 1 })) },
    statementPayout: { createMany: vi.fn(async () => ({ count: 0 })) },
    auditLog: { create: vi.fn(async () => ({ id: "audit_1" })) },
    $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
  };
  return { state, db, renderPdf: vi.fn(async () => Buffer.from("%PDF-test")), loadLedger: vi.fn() };
});

vi.mock("@/sentinel/db", () => ({ getDatabase: () => mocks.db }));
vi.mock("@/sentinel/config", () => ({ getServerEnv: () => ({ STATEMENTS_ENABLED: true, STATEMENT_TIMEZONE: "America/Chicago" }) }));
vi.mock("@/statements/pdf", () => ({ renderStatementPdf: mocks.renderPdf }));
vi.mock("@/statements/source", () => ({ loadAuthoritativeLedger: mocks.loadLedger }));

import { generateMerchantStatements } from "@/statements/service";

describe("merchant statement generation integration", () => {
  beforeEach(() => {
    mocks.state.statement = null; vi.clearAllMocks();
    mocks.loadLedger.mockResolvedValue([{ currency: "USD", openingBalanceMinor: BigInt(500), payouts: [], entries: [{ externalId: "txn_1", type: "PAYMENT", processorType: "charge", reportingCategory: "charge", reference: "pi_1", description: "Order 1", amountMinor: BigInt(10_000), processingFeeMinor: BigInt(300), orbitFeeMinor: BigInt(300), netMinor: BigInt(9_400), occurredAt: new Date("2026-08-10T12:00:00Z") }] }]);
  });

  it("finalizes one immutable snapshot and returns it idempotently on duplicate execution", async () => {
    const first = await generateMerchantStatements({ merchantId: "merchant_1", year: 2026, month: 8 });
    expect(first.results[0]).toMatchObject({ existing: false, statement: { status: "FINALIZED", checksum: expect.any(String), pdfSha256: expect.any(String) } });
    expect(mocks.db.statementLineItem.createMany).toHaveBeenCalledTimes(1); expect(mocks.renderPdf).toHaveBeenCalledTimes(1);
    const second = await generateMerchantStatements({ merchantId: "merchant_1", year: 2026, month: 8 });
    expect(second.results[0]).toMatchObject({ existing: true, statement: { id: "stmt_1" } });
    expect(mocks.db.statementLineItem.createMany).toHaveBeenCalledTimes(1); expect(mocks.renderPdf).toHaveBeenCalledTimes(1);
  });

  it("keeps every download and mutation route behind server-side merchant authorization", async () => {
    const root = process.cwd();
    const routeFiles = [
      "src/app/api/portal/statements/[statementId]/pdf/route.ts",
      "src/app/api/portal/statements/[statementId]/csv/route.ts",
      "src/app/api/portal/statements/[statementId]/email/route.ts",
    ];
    for (const file of routeFiles) expect(await readFile(path.join(root, file), "utf8")).toContain("requirePortalMerchantAccess(request, statement.merchantId");
    const schema = await readFile(path.join(root, "prisma/schema.prisma"), "utf8");
    expect(schema).toContain("@@unique([merchantId, periodStart, currency, version])");
  });
});
