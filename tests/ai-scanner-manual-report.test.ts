import { describe, expect, it } from "vitest";
import { analyzeImportedDocument, extractManualImport, parseOrbitReportMetrics, splitImportedText, validateAiScanManualImport, validateAiScanManualReport } from "@/ai-scanner/manual-report";

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

  it("accepts pasted text and preserves every character across indexed chunks", async () => {
    const original = `Beginning\n${"complete-information-".repeat(6_000)}\nEnd`;
    const upload = await validateAiScanManualImport({ text: original, format: "text" });
    const extracted = await extractManualImport(upload);
    expect(upload.kind).toBe("TEXT");
    expect(extracted.fullText).toBe(original);
    expect(extracted.pages.map((page) => page.text).join("")).toBe(original);
    expect(extracted.pages.length).toBeGreaterThan(1);
    expect(extracted.metrics.characterCount).toBe(original.length);
  });

  it("accepts JSON, preserves the source, and reads structured assessment metrics", async () => {
    const original = JSON.stringify({ healthScore: 91, coverage: { pagesOpened: ["a", "b", "c"], imagesInspected: 7 }, findings: [{ severity: "HIGH" }, { severity: "low" }], documentation: { untouched: true } });
    const upload = await validateAiScanManualImport({ text: original, format: "json" });
    const extracted = await extractManualImport(upload);
    expect(upload.mimeType).toBe("application/json");
    expect(extracted.fullText).toBe(original);
    expect(extracted.metrics).toMatchObject({ source: "IMPORTED_JSON", healthScore: 91, coverage: { pagesOpened: 3, imagesInspected: 7 }, severity: { high: 1, low: 1 } });
  });

  it("rejects invalid pasted JSON without storing a partial interpretation", async () => {
    await expect(validateAiScanManualImport({ text: "{ incomplete", format: "json" })).rejects.toMatchObject({ status: 422 });
  });

  it("splits content without trimming, normalizing, or dropping boundaries", () => {
    const original = `${"a".repeat(50_000)}\n${"b".repeat(50_001)}`;
    expect(splitImportedText(original).map((chunk) => chunk.text).join("")).toBe(original);
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

  it("extracts Spanish ORBIT coverage and a slash-form Health Score", () => {
    const metrics = parseOrbitReportMetrics(`ORBIT\nEscáner de IA ORBIT v1\nPáginas abiertas\n6\nPáginas visuales\n6\nRegiones visuales\n8\nImágenes\n2\nCategorías\n1\nProductos verificados\n0\nDocumentos\n0\nEstados de pago\n1\nHerramientas Luna\n12\nPuntuación del escáner de IA transparente\n87/100`, 4);
    expect(metrics.healthScore).toBe(87);
    expect(metrics.coverage).toMatchObject({ pagesOpened: 6, pagesVisuallyReviewed: 6, visualRegionsInspected: 8, imagesInspected: 2, categoriesInspected: 1, productsVerified: 0, documentsInspected: 0, checkoutStatesInspected: 1, totalLunaToolCalls: 12 });
  });

  it("accepts a post-remediation web audit with a posture score", () => {
    const metrics = parseOrbitReportMetrics(`CORE AMINOS\nWEB AUDIT\nVALIDATION 04 - POST-REMEDIATION REVIEW\nPOSTURE SCORE\n95 / 100\nMATERIAL ISSUES\n0 OPEN\n0 Critical - 0 High\nFINAL ASSESSMENT\n95 / 100 - Strong Compliance Posture`, 8);
    expect(metrics).toMatchObject({ source: "ORBIT_REPORT_PDF", pageCount: 8, healthScore: 95, severity: { critical: 0, high: 0 } });
  });

  it("recognizes the merchant intelligence layout and materializes its dashboard zones", () => {
    const text = `ORBIT SENTINEL\n34 /100\nORBIT internal health score\nOBSERVED COVERAGE 93%\nFirst-party URLs discovered 106\nURLs fetched / analyzed 106/106\nProducts discovered / reviewed 50 / 50\nUnique product images reviewed 51 / 51\nPolicies reviewed 7 / 7 observed\nCheckout states 1\nTOTAL 34 / 100`;
    const metrics = parseOrbitReportMetrics(text, 22);
    const analysis = analyzeImportedDocument([
      { pageNumber: 4, extraction: "TEXT_LAYER", text: "Priority findings\nP0   Peptide Calculator   CRITICAL   Remove the public dose workflow.\nP1   Policy contradictions   HIGH   Reconcile the policies." },
      { pageNumber: 5, extraction: "TEXT_LAYER", text: "Complete product inventory 1/1", layoutItems: [
        { text: "2231", x: 48, y: 600 }, { text: "Adamax-1032 10mg", x: 82, y: 600 }, { text: "PLR-AX-J101", x: 243, y: 600 }, { text: "$65.00", x: 313, y: 600 }, { text: "Peptides", x: 383, y: 600 }, { text: "`adamax-1032-10mg`", x: 475, y: 600 },
      ] },
      { pageNumber: 21, extraction: "TEXT_LAYER", text: "Score, acceptance checklist & limitations\nDOMAIN SCORE\nCatalog and intended-use controls   7 / 25\nTOTAL   34 / 100" },
    ], metrics);

    expect(metrics).toMatchObject({ healthScore: 34, coverage: { urlsDiscovered: 106, pagesOpened: 106, productsDiscovered: 50, productsVerified: 50, imagesInspected: 51, documentsInspected: 7, checkoutStatesInspected: 1, observedCoveragePercent: 93 } });
    expect(analysis.findings).toMatchObject([{ title: "Peptide Calculator", severity: "CRITICAL", remediation: "Remove the public dose workflow." }, { title: "Policy contradictions", severity: "HIGH" }]);
    expect(analysis.products).toMatchObject([{ sourceId: "2231", name: "Adamax-1032 10mg", sku: "PLR-AX-J101", price: "$65.00", category: "Peptides", slug: "adamax-1032-10mg" }]);
    expect(analysis.scoreBreakdown).toEqual({ "Catalog and intended-use controls": { score: 7, maximum: 25 } });
  });
});
