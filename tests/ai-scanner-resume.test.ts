import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditCoverage, AuditUsage } from "@/ai-scanner/types";

const { database, enqueueAiScan, runLunaAudit, tools } = vi.hoisted(() => {
  const usage: AuditUsage = { responseCalls: 3, inputTokens: 12_000, outputTokens: 900, cachedTokens: 2_000, totalTokens: 12_900, approximateCostUsd: 0.00348 };
  const coverage: AuditCoverage = {
    urlsDiscovered: ["https://merchant.example/"],
    firstPartyUrlsDiscovered: ["https://merchant.example/", "https://merchant.example/products/a"],
    firstPartyUrlsRemaining: ["https://merchant.example/products/a"],
    siteInventoryInspected: true,
    pagesOpened: ["https://merchant.example/"],
    pagesVisuallyReviewed: ["https://merchant.example/"],
    visualRegionsInspected: 1,
    imagesInspected: 1,
    categoriesInspected: ["Catalog"],
    productsDiscovered: 1,
    productsVerified: 0,
    productPagesWithImagesInspected: [],
    documentsInspected: [],
    policyPagesInspected: [],
    publicAccessGatesDismissed: ["https://merchant.example/"],
    commerceSignalsObserved: true,
    checkoutStatesInspected: [],
    checkoutFormsInspected: 0,
    totalLunaToolCalls: 7,
    auditRuntimeMs: 45_000,
    tokenUsage: usage,
  };
  return {
    database: {
      aiScan: { findUniqueOrThrow: vi.fn(), update: vi.fn(async () => undefined) },
      merchant: { update: vi.fn(async () => undefined) },
      auditLog: { create: vi.fn(async () => undefined) },
    },
    enqueueAiScan: vi.fn(async () => undefined),
    runLunaAudit: vi.fn(),
    tools: {
      budget: { maximumRuntimeMs: 3_600_000, maximumToolCalls: 400, maximumTokens: 20_000_000, maximumCostUsd: 50 },
      start: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      checkpoint: vi.fn(async () => ({ version: 1, storageState: { cookies: [], origins: [] }, currentUrl: "https://merchant.example/", validPublicHosts: ["merchant.example"], canonicalHostAliases: [], productsDiscoveredUrls: ["https://merchant.example/products/a"] })),
      coverage: vi.fn(() => coverage),
      setUsage: vi.fn(),
      budgetExceeded: vi.fn(() => false),
      execute: vi.fn(),
      imageInputs: vi.fn(async () => []),
    },
  };
});

vi.mock("@/sentinel/db", () => ({ getDatabase: () => database }));
vi.mock("@/ai-scanner/queue", () => ({ enqueueAiScan }));
vi.mock("@/ai-scanner/tools/browser-session", () => ({ LunaBrowserTools: vi.fn(function LunaBrowserToolsMock() { return tools; }) }));
vi.mock("@/ai-scanner/luna/agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ai-scanner/luna/agent")>();
  return { ...actual, runLunaAudit };
});
vi.mock("@/ai-scanner/critic", () => ({ runOptionalCritics: vi.fn() }));
vi.mock("@/ai-scanner/validation", () => ({ validateLunaAudit: vi.fn(), persistValidatedAudit: vi.fn() }));

import { LunaRateLimitError } from "@/ai-scanner/luna/agent";
import { runAiScan } from "@/ai-scanner/run";

describe("AI Scanner rate-limit continuation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.aiScan.findUniqueOrThrow.mockResolvedValue({
      id: "scan-1",
      merchantId: "merchant-1",
      siteId: "site-1",
      status: "RUNNING",
      model: "gpt-5.6-luna",
      score: null,
      startedAt: new Date("2026-08-26T20:00:00.000Z"),
      coverage: {},
      usage: {},
      resumeCheckpoint: {},
      resumeAfter: null,
      resumeCount: 0,
      merchant: { id: "merchant-1", businessName: "Merchant", organizationId: "org-1", sites: [{ hostname: "merchant.example" }] },
      site: { id: "site-1", normalizedUrl: "https://merchant.example/", hostname: "merchant.example" },
    });
    runLunaAudit.mockImplementation(async (input: { onCheckpoint?: (value: unknown) => Promise<void> }) => {
      await input.onCheckpoint?.({
        version: 1,
        conversation: [{ role: "user", content: [{ type: "input_text", text: "resume" }] }],
        usage: tools.coverage().tokenUsage,
        lastInputTokens: 12_000,
        firstTurn: false,
        forceFinalization: null,
        finalizationNoticeAdded: false,
        finalizationAttempts: 0,
        investigationRecoveryPrompts: 0,
        forceOpenRecovery: false,
        compactionCount: 0,
      });
      throw new LunaRateLimitError("temporary TPM", "TOKENS_PER_MINUTE", 5, 90_000);
    });
  });

  it("pauses for manual continuation with its retained checkpoint", async () => {
    const result = await runAiScan("scan-1");

    expect(result.status).toBe("AI_SCAN_INCOMPLETE");
    expect(enqueueAiScan).not.toHaveBeenCalled();
    expect(database.aiScan.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "scan-1" },
      data: expect.objectContaining({ status: "AI_SCAN_INCOMPLETE", resumeAfter: null, failureCode: "AI_SCAN_INCOMPLETE" }),
    }));
    expect(database.aiScan.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ resumeCheckpoint: expect.objectContaining({ version: 1 }) }),
    }));
    expect(database.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ aiScanId: "scan-1", action: "ai_scanner.manual_resume_required" }),
    }));
    expect(tools.close).toHaveBeenCalledOnce();
  });

  it("converts a legacy automatic continuation job into a manual pause without calling Luna", async () => {
    database.aiScan.findUniqueOrThrow.mockResolvedValue({
      id: "scan-1",
      merchantId: "merchant-1",
      siteId: "site-1",
      status: "QUEUED",
      resumeCount: 12,
      resumeCheckpoint: { version: 1, luna: { conversation: [] }, browser: { currentUrl: "https://merchant.example/" } },
      coverage: tools.coverage(),
      usage: tools.coverage().tokenUsage,
      score: null,
      merchant: { id: "merchant-1", businessName: "Merchant", organizationId: "org-1", sites: [{ hostname: "merchant.example" }] },
      site: { id: "site-1", normalizedUrl: "https://merchant.example/", hostname: "merchant.example" },
    });

    const result = await runAiScan("scan-1");

    expect(result.status).toBe("AI_SCAN_INCOMPLETE");
    expect(runLunaAudit).not.toHaveBeenCalled();
    expect(enqueueAiScan).not.toHaveBeenCalled();
    expect(database.aiScan.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "AI_SCAN_INCOMPLETE", resumeAfter: null }),
    }));
  });
});
