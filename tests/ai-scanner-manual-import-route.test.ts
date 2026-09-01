import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  validate: vi.fn(),
  extract: vi.fn(),
  put: vi.fn(),
  findFirst: vi.fn(),
  upsert: vi.fn(),
  createMany: vi.fn(),
  evidenceDeleteMany: vi.fn(),
  update: vi.fn(),
  scanDeleteMany: vi.fn(),
  auditCreate: vi.fn(),
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
    $transaction: async (callback: (tx: unknown) => Promise<void>) => callback({
      aiEvidence: { upsert: mocks.upsert, createMany: mocks.createMany, deleteMany: mocks.evidenceDeleteMany },
      aiScan: { update: mocks.update, deleteMany: mocks.scanDeleteMany },
      auditLog: { create: mocks.auditCreate },
    }),
  }),
}));

import { POST } from "@/app/api/ai-scanner/scans/[scanId]/manual-report/route";

describe("AI Scanner document import route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue({ id: "scan-1", merchantId: "merchant-1", importedReportSha256: "older-sha", site: { normalizedUrl: "https://merchant.example/" } });
    mocks.validate.mockResolvedValue({ bytes: new TextEncoder().encode("all source text"), sha256: "a".repeat(64), originalName: "evidence.txt", mimeType: "text/plain", kind: "TEXT", text: "all source text" });
    mocks.extract.mockResolvedValue({
      fullText: "all source text",
      pages: [{ pageNumber: 1, text: "all source text", extraction: "TEXT_LAYER" }],
      metrics: { source: "IMPORTED_TEXT", pageCount: 1, characterCount: 15, coverage: {}, severity: { critical: 0, high: 0, medium: 0, low: 0 } },
    });
    mocks.upsert.mockResolvedValue({ id: "evidence-import-1" });
    mocks.createMany.mockResolvedValue({ count: 1 });
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
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ importedReportMimeType: "text/plain", summary: expect.stringContaining("complete source content") }) }));
  });
});
