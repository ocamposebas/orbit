import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  validate: vi.fn(),
  extract: vi.fn(),
  put: vi.fn(),
  findFirst: vi.fn(),
  upsert: vi.fn(),
  createMany: vi.fn(),
  evidenceFindMany: vi.fn(),
  evidenceDeleteMany: vi.fn(),
  findingDeleteMany: vi.fn(),
  findingCreate: vi.fn(),
  findingEvidenceCreate: vi.fn(),
  productDeleteMany: vi.fn(),
  productCreateMany: vi.fn(),
  merchantUpdate: vi.fn(),
  update: vi.fn(),
  scanDeleteMany: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/ai-scanner/manual-report", () => ({
  validateAiScanManualImport: mocks.validate,
  extractManualImport: mocks.extract,
}));

vi.mock("@/sentinel/auth/session", () => ({
  requestSession: vi.fn(async () => ({ role: "ADMIN", user: { id: "user-1" }, organization: { id: "org-1" } })),
}));

vi.mock("@/sentinel/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/sentinel/storage", () => ({ evidenceStorage: () => ({ put: mocks.put, get: vi.fn() }) }));
vi.mock("@/sentinel/http", () => {
  class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
  return {
    HttpError,
    merchantScope: vi.fn(() => ({ organizationId: "org-1" })),
    validateMutationOrigin: vi.fn(),
    apiError: (error: unknown) => Response.json({ error: error instanceof Error ? error.message : "Unexpected" }, { status: error instanceof HttpError ? error.status : 500 }),
  };
});

vi.mock("@/sentinel/db", () => ({
  getDatabase: () => ({
    aiScan: { findFirst: mocks.findFirst, deleteMany: mocks.scanDeleteMany },
    aiEvidence: { deleteMany: mocks.evidenceDeleteMany },
    $transaction: mocks.transaction,
  }),
}));

import { POST } from "@/app/api/ai-scanner/scans/[scanId]/manual-report/route";

describe("AI Scanner document import route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => callback({
      aiEvidence: { upsert: mocks.upsert, createMany: mocks.createMany, findMany: mocks.evidenceFindMany, deleteMany: mocks.evidenceDeleteMany },
      aiFinding: { deleteMany: mocks.findingDeleteMany, create: mocks.findingCreate },
      aiFindingEvidence: { create: mocks.findingEvidenceCreate },
      aiProduct: { deleteMany: mocks.productDeleteMany, createMany: mocks.productCreateMany },
      aiScan: { update: mocks.update, deleteMany: mocks.scanDeleteMany },
      merchant: { update: mocks.merchantUpdate },
      auditLog: { create: mocks.auditCreate },
    }));
    mocks.findFirst.mockResolvedValue({ id: "scan-1", merchantId: "merchant-1", importedReportSha256: "older-sha", site: { normalizedUrl: "https://merchant.example/" } });
    mocks.validate.mockResolvedValue({ bytes: new TextEncoder().encode("all source text"), sha256: "a".repeat(64), originalName: "evidence.txt", mimeType: "text/plain", kind: "TEXT", text: "all source text" });
    mocks.extract.mockResolvedValue({
      fullText: "all source text",
      pages: [{ pageNumber: 1, text: "all source text", extraction: "TEXT_LAYER" }],
      metrics: { source: "IMPORTED_TEXT", pageCount: 1, characterCount: 15, coverage: {}, severity: { critical: 0, high: 0, medium: 0, low: 0 } },
      analysis: {
        summary: "Imported document fully indexed.",
        scoreBreakdown: { Policies: { score: 8, maximum: 20 } },
        findings: [{ title: "Policy contradiction", severity: "HIGH", explanation: "Two policies conflict.", remediation: "Consolidate the policies.", pageNumber: 1 }],
        products: [{ sourceId: "44", name: "Imported product", sku: "SKU-44", price: "$10", currency: "USD", slug: "imported-product", pageNumber: 1 }],
        observations: [{ text: "all source text", pageNumber: 1 }],
        limitations: ["Checkout not observed."],
      },
    });
    mocks.upsert.mockResolvedValue({ id: "evidence-import-1" });
    mocks.createMany.mockResolvedValue({ count: 1 });
    mocks.evidenceFindMany.mockResolvedValue([{ id: "evidence-page-1", sha256: expect.anything() }]);
    mocks.findingDeleteMany.mockResolvedValue({ count: 0 });
    mocks.findingCreate.mockResolvedValue({ id: "finding-1" });
    mocks.findingEvidenceCreate.mockResolvedValue({});
    mocks.productDeleteMany.mockResolvedValue({ count: 0 });
    mocks.productCreateMany.mockResolvedValue({ count: 0 });
    mocks.merchantUpdate.mockResolvedValue({});
    mocks.update.mockResolvedValue({});
    mocks.auditCreate.mockResolvedValue({});
  });

  it("stores the source and indexed content without deleting earlier evidence or sibling scans", async () => {
    const formData = new FormData();
    formData.set("content", "all source text");
    formData.set("format", "text");
    const request = new NextRequest("https://orbit.example/api/ai-scanner/scans/scan-1/manual-report", { method: "POST", body: formData, headers: { origin: "https://orbit.example" } });
    const response = await POST(request, { params: Promise.resolve({ scanId: "scan-1" }) });

    expect(response.status).toBe(201);
    expect(mocks.put).toHaveBeenCalledOnce();
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ exactText: "all source text", storageKey: expect.stringMatching(/\.txt$/) }) }));
    expect(mocks.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ exactText: "all source text" })], skipDuplicates: true }));
    expect(mocks.evidenceDeleteMany).not.toHaveBeenCalled();
    expect(mocks.scanDeleteMany).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ importedReportMimeType: "text/plain", summary: "Imported document fully indexed.", observations: expect.any(Array) }) }));
    expect(mocks.findingDeleteMany).toHaveBeenCalledWith({ where: { scanId: "scan-1" } });
    expect(mocks.productDeleteMany).toHaveBeenCalledWith({ where: { scanId: "scan-1" } });
    expect(mocks.findingCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: "Policy contradiction", severity: "HIGH", remediation: "Consolidate the policies." }) }));
    expect(mocks.findingEvidenceCreate).toHaveBeenCalledOnce();
    expect(mocks.productCreateMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ name: "Imported product", sku: "SKU-44", verified: true })] }));
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 15_000, timeout: 120_000 });
  });

  it("returns a retryable message when storing a large import exceeds the transaction window", async () => {
    mocks.transaction.mockRejectedValueOnce(Object.assign(new Error("Transaction expired"), { code: "P2028" }));
    const formData = new FormData();
    formData.set("content", "all source text");
    formData.set("format", "text");
    const request = new NextRequest("https://orbit.example/api/ai-scanner/scans/scan-1/manual-report", { method: "POST", body: formData, headers: { origin: "https://orbit.example" } });
    const response = await POST(request, { params: Promise.resolve({ scanId: "scan-1" }) });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("saving its indexed results took too long") });
  });
});
