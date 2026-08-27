import { describe, expect, it } from "vitest";
import { parseOrbitReportMetrics, validateAiScanManualReport } from "@/ai-scanner/manual-report";

function pdfBytes() {
  return new TextEncoder().encode(`%PDF-1.7\n${"0".repeat(100)}\n%%EOF`);
}

describe("AI Scanner manual PDF report", () => {
  it("accepts a bounded PDF and returns integrity metadata", async () => {
    const file = new File([pdfBytes()], "merchant-report.pdf", { type: "application/pdf" });
    const result = await validateAiScanManualReport(file);
    expect(result.originalName).toBe("merchant-report.pdf");
    expect(result.bytes.byteLength).toBe(file.size);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects renamed non-PDF content", async () => {
    const file = new File(["not a real pdf".repeat(20)], "fake.pdf", { type: "application/pdf" });
    await expect(validateAiScanManualReport(file)).rejects.toMatchObject({ status: 415 });
  });

  it("rejects a truncated PDF without an EOF marker", async () => {
    const file = new File([`%PDF-1.7\n${"0".repeat(100)}`], "truncated.pdf", { type: "application/pdf" });
    await expect(validateAiScanManualReport(file)).rejects.toMatchObject({ status: 415 });
  });

  it("extracts ORBIT score, coverage, and severity metrics from report text", () => {
    const metrics = parseOrbitReportMetrics(`ORBIT AI SCANNER\n78\nHealth Score\n12\nURLs discovered\n9\nPages opened\n4\nProducts verified\n2\nHigh\n1\nMedium`, 7);
    expect(metrics).toMatchObject({
      source: "ORBIT_REPORT_PDF",
      pageCount: 7,
      healthScore: 78,
      coverage: { urlsDiscovered: 12, pagesOpened: 9, productsVerified: 4 },
      severity: { critical: 0, high: 2, medium: 1, low: 0 },
    });
  });

  it("rejects arbitrary PDFs that are not recognizable ORBIT reports", () => {
    expect(() => parseOrbitReportMetrics("Generic PDF with unrelated content", 1)).toThrowError();
  });
});
