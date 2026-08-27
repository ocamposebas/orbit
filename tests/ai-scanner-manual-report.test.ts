import { describe, expect, it } from "vitest";
import { validateAiScanManualReport } from "@/ai-scanner/manual-report";

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
});
