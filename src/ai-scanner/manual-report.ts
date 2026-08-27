import { createHash } from "node:crypto";
import { HttpError } from "@/sentinel/http";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

export const AI_SCAN_MANUAL_REPORT_MAX_BYTES = 25 * 1024 * 1024;

export async function validateAiScanManualReport(file: unknown) {
  if (!(file instanceof File)) throw new HttpError(400, "Choose a PDF report to upload");
  if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) throw new HttpError(415, "The manual report must be a PDF file");
  if (file.size < 100 || file.size > AI_SCAN_MANUAL_REPORT_MAX_BYTES) throw new HttpError(413, "The PDF report must be between 100 bytes and 25 MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder("ascii").decode(bytes.slice(0, 5)) !== "%PDF-") throw new HttpError(415, "The uploaded file does not have a valid PDF header");
  const trailer = new TextDecoder("ascii").decode(bytes.slice(Math.max(0, bytes.length - 2_048)));
  if (!trailer.includes("%%EOF")) throw new HttpError(415, "The uploaded PDF is incomplete or missing its end marker");
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    originalName: file.name.replace(/[\r\n"\\/]/g, "_").slice(0, 180),
  };
}

export type ImportedReportMetrics = {
  source: "ORBIT_REPORT_PDF";
  pageCount: number;
  healthScore?: number;
  coverage: Record<string, number>;
  severity: Record<"critical" | "high" | "medium" | "low", number>;
};

function nearbyInteger(lines: string[], label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const line of lines) {
    const after = line.match(new RegExp(`${escaped}\\s+(\\d{1,9})(?:\\b|$)`, "i"));
    if (after) return Number(after[1]);
    const before = line.match(new RegExp(`(?:^|\\s)(\\d{1,9})\\s+${escaped}(?:\\b|$)`, "i"));
    if (before) return Number(before[1]);
  }
  const index = lines.findIndex((line) => line.toLowerCase() === label.toLowerCase());
  if (index < 0) return undefined;
  for (const offset of [-1, 1, -2, 2]) {
    const match = lines[index + offset]?.replaceAll(",", "").match(/^\d{1,9}$/);
    if (match) return Number(match[0]);
  }
  return undefined;
}

export function parseOrbitReportMetrics(text: string, pageCount: number): ImportedReportMetrics {
  const normalized = text.replace(/\s+/g, " ");
  if (!/\bORBIT\b/i.test(normalized) || !/(AI SCANNER|SENTINEL)/i.test(normalized)) {
    throw new HttpError(422, "The PDF is readable but is not a recognized ORBIT report");
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const healthScore = nearbyInteger(lines, "Health Score");
  const labels = {
    urlsDiscovered: "URLs discovered",
    pagesOpened: "Pages opened",
    pagesVisuallyReviewed: "Pages visually reviewed",
    visualRegionsInspected: "Visual regions inspected",
    imagesInspected: "Images inspected",
    categoriesInspected: "Categories inspected",
    productsDiscovered: "Products discovered",
    productsVerified: "Products verified",
    documentsInspected: "Documents inspected",
    checkoutStatesInspected: "Checkout states inspected",
    totalLunaToolCalls: "Luna tool calls",
  } as const;
  const coverage = Object.fromEntries(Object.entries(labels).flatMap(([key, label]) => {
    const value = nearbyInteger(lines, label);
    return value === undefined ? [] : [[key, value]];
  }));
  const severity = {
    critical: nearbyInteger(lines, "Critical") ?? 0,
    high: nearbyInteger(lines, "High") ?? 0,
    medium: nearbyInteger(lines, "Medium") ?? 0,
    low: nearbyInteger(lines, "Low") ?? 0,
  };
  if (healthScore === undefined && Object.keys(coverage).length < 2 && !Object.values(severity).some(Boolean)) {
    throw new HttpError(422, "The ORBIT PDF does not contain enough recognizable report metrics");
  }
  return { source: "ORBIT_REPORT_PDF", pageCount, ...(healthScore === undefined ? {} : { healthScore }), coverage, severity };
}

export async function extractOrbitReportMetrics(bytes: Uint8Array) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false }).promise;
  const lines: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const grouped = new Map<number, Array<{ x: number; text: string }>>();
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const textItem = item as TextItem;
        const y = Math.round(textItem.transform[5]);
        const row = grouped.get(y) ?? [];
        row.push({ x: textItem.transform[4], text: textItem.str });
        grouped.set(y, row);
      }
      for (const [, row] of [...grouped].sort(([a], [b]) => b - a)) lines.push(row.sort((a, b) => a.x - b.x).map((item) => item.text).join(" ").trim());
    }
    return parseOrbitReportMetrics(lines.join("\n"), document.numPages);
  } finally {
    // pdf.js may reject destroy() with AbortException after its text streams
    // have already completed. Cleanup must never replace a successful parse or
    // the actionable HttpError raised for an unrecognized report.
    await document.destroy().catch(() => undefined);
  }
}
