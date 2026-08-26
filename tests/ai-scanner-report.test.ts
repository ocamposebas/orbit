import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUniqueOrThrow: vi.fn(),
  getEvidence: vi.fn(),
  setContent: vi.fn(),
  pdf: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@/sentinel/db", () => ({
  getDatabase: () => ({ aiScan: { findUniqueOrThrow: mocks.findUniqueOrThrow } }),
}));

vi.mock("@/sentinel/storage", () => ({
  evidenceStorage: () => ({ get: mocks.getEvidence }),
}));

vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn(async () => ({
      newPage: async () => ({ setContent: mocks.setContent, pdf: mocks.pdf }),
      close: mocks.close,
    })),
  },
}));

import { renderAiScanReportPdf } from "@/ai-scanner/report";

describe("AI Scanner report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pdf.mockResolvedValue(Buffer.from("report-pdf"));
    mocks.getEvidence.mockResolvedValue(Buffer.from("retained-pixels"));
    mocks.findUniqueOrThrow.mockResolvedValue({
      id: "scan-1",
      status: "COMPLETED",
      score: 78,
      model: "gpt-5.6-luna",
      summary: "Luna inspected the storefront and retained the cited evidence.",
      observations: [{ text: "Rendered product composition inspected.", evidenceIds: ["ev-visual"] }],
      limitations: ["Authenticated account areas were not available."],
      runtimeMs: 1_500,
      toolCalls: 8,
      coverage: {
        pagesOpened: ["https://merchant.example/", "https://merchant.example/products/a"],
        pagesVisuallyReviewed: ["https://merchant.example/", "https://merchant.example/products/a"],
        visualRegionsInspected: 3,
        imagesInspected: 2,
        categoriesInspected: ["Catalog"],
        productsVerified: 1,
        documentsInspected: [],
        checkoutStatesInspected: ["https://merchant.example/cart"],
        totalLunaToolCalls: 8,
        auditRuntimeMs: 1_500,
        tokenUsage: { totalTokens: 1_200, approximateCostUsd: 0.0005 },
      },
      merchant: { businessName: "Industry-neutral merchant", industry: "Industrial equipment", country: "US" },
      site: { normalizedUrl: "https://merchant.example/" },
      products: [{ name: "Bench press", sku: null, price: "1200", currency: "USD", canonicalUrl: "https://merchant.example/products/a" }],
      findings: [{
        id: "finding-1",
        title: "Observed commercial representation requires review",
        severity: "HIGH",
        confidence: 0.84,
        theme: "Commercial representation",
        category: "Merchandising",
        explanation: "The conclusion is grounded in the retained visual composition.",
        affectedUrl: "https://merchant.example/products/a",
        affectedProduct: "Bench press",
        affectedCategory: "Catalog",
        verifiedSku: null,
        materiality: "MATERIAL",
        commercialProminence: 0.8,
        visualProminence: 0.7,
        remediation: "Revise the cited composition on the affected product page.",
        criticReview: null,
        createdAt: new Date(),
        evidence: [{
          role: "ADVERSE",
          rationale: "Rendered visual evidence",
          evidence: { id: "ev-visual", sourceUrl: "https://merchant.example/products/a", kind: "VISUAL_REGION", exactText: "Visible representation", storageKey: "scan-1/ev-visual.jpg", mimeType: "image/jpeg" },
        }],
      }],
    });
  });

  it("renders coverage, findings, product identity, retained pixels, remediation, and limitations", async () => {
    const pdf = await renderAiScanReportPdf("scan-1");

    expect(pdf.toString()).toBe("report-pdf");
    expect(mocks.setContent).toHaveBeenCalledOnce();
    const html = mocks.setContent.mock.calls[0][0] as string;
    expect(html).toContain("Industry-neutral merchant");
    expect(html).toContain("Pages visually reviewed");
    expect(html).toContain("Bench press");
    expect(html).toContain("Not observed");
    expect(html).toContain("data:image/jpeg;base64");
    expect(html).toContain("Specific remediation");
    expect(html).toContain("Authenticated account areas were not available.");
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
