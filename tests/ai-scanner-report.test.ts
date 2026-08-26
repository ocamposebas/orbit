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
      createdAt: new Date("2026-08-26T13:00:00.000Z"),
      completedAt: new Date("2026-08-26T13:00:01.500Z"),
      summary: "Luna inspected the storefront and retained the cited evidence.",
      observations: [{ text: "Rendered product composition inspected.", evidenceIds: ["ev-visual"] }],
      limitations: ["Authenticated account areas were not available."],
      scoreBreakdown: { formulaVersion: "ai-scanner-score-v1", riskDeduction: 18, uncertaintyReservation: 4, deductions: [] },
      usage: { responseCalls: 4, inputTokens: 950, outputTokens: 250, cachedTokens: 0, totalTokens: 1_200, approximateCostUsd: 0.0005 },
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
      site: { normalizedUrl: "https://merchant.example/", hostname: "merchant.example" },
      evidence: [{
        id: "ev-links",
        sourceUrl: "https://merchant.example/",
        destinationUrl: null,
        metadata: {},
        surroundingDom: { links: [{ href: "https://merchant.example/privacy" }, { href: "https://merchant.example/returns" }] },
      }],
      products: [{
        name: "Bench press",
        sku: null,
        price: "1200",
        currency: "USD",
        canonicalUrl: "https://merchant.example/products/a",
        variants: [],
        categories: ["Machinery"],
        createdAt: new Date("2026-08-26T13:00:00.000Z"),
      }],
      findings: [{
        id: "finding-1",
        status: "OPEN",
        title: "Observed commercial representation requires review",
        severity: "HIGH",
        confidence: 0.84,
        theme: "Commercial representation",
        category: "Merchandising",
        explanation: "The conclusion is grounded in the retained visual composition.",
        affectedUrl: "https://merchant.example/products/a",
        contentType: "product",
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
          evidenceId: "ev-visual",
          role: "ADVERSE",
          rationale: "Rendered visual evidence",
          evidence: { id: "ev-visual", sourceUrl: "https://merchant.example/products/a", destinationUrl: null, kind: "VISUAL_REGION", exactText: "Visible representation", storageKey: "scan-1/ev-visual.jpg", mimeType: "image/jpeg" },
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
    expect(html).toContain("ORBIT");
    expect(html).toContain("AI SCANNER");
    expect(html).toContain("Merchant intelligence report");
    expect(html).toContain("Health Score");
    expect(html).toContain("Executive assessment");
    expect(html).toContain("Investigation coverage");
    expect(html).toContain("Key risk themes");
    expect(html).toContain("Products reviewed");
    expect(html).toContain("Policy coverage");
    expect(html).toContain("Severity summary");
    expect(html).toContain("Adverse Evidence");
    expect(html).toContain("Mitigating Evidence");
    expect(html).toContain("Neutral / Supporting Context");
    expect(html).toContain("Why it was flagged");
    expect(html).toContain("Recommended Remediation");
    expect(html).toContain("Method & limitations");
    expect(html).toContain("Bench press");
    expect(html).toContain("Not observed");
    expect(html).toContain("data:image/jpeg;base64");
    expect(html).toContain("Revise the cited composition on the affected product page.");
    expect(html).toContain("Authenticated account areas were not available.");
    expect(html).toContain("https://merchant.example/privacy");
    expect(mocks.pdf).toHaveBeenCalledWith(expect.objectContaining({
      displayHeaderFooter: true,
      footerTemplate: expect.stringContaining("pageNumber"),
    }));
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
