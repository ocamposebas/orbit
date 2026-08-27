import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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

function nearbyInteger(lines: string[], label: string, preferAfter = false) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const line of lines) {
    const after = line.match(new RegExp(`${escaped}\\s+(\\d{1,9})(?:\\b|$)`, "i"));
    if (after) return Number(after[1]);
    const before = line.match(new RegExp(`(?:^|\\s)(\\d{1,9})\\s+${escaped}(?:\\b|$)`, "i"));
    if (before) return Number(before[1]);
  }
  const index = lines.findIndex((line) => line.toLowerCase() === label.toLowerCase());
  if (index < 0) return undefined;
  for (const offset of preferAfter ? [1, 2, -1, -2] : [-1, 1, -2, 2]) {
    const match = lines[index + offset]?.replaceAll(",", "").match(/^\d{1,9}$/);
    if (match) return Number(match[0]);
  }
  return undefined;
}

function nearbyIntegerForLabels(lines: string[], labels: string[], preferAfter = false) {
  for (const label of labels) {
    const value = nearbyInteger(lines, label, preferAfter);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function parseOrbitReportMetrics(text: string, pageCount: number): ImportedReportMetrics {
  const normalized = text.replace(/\s+/g, " ");
  const orbitScannerReport = /\bORBIT\b/i.test(normalized) && /(AI SCANNER|ESC[AÁ]NER DE IA|SENTINEL)/i.test(normalized);
  const postRemediationAudit = /\bWEB AUDIT\b/i.test(normalized) && /(POST[- ]REMEDIATION|VALIDATION)/i.test(normalized);
  if (!orbitScannerReport && !postRemediationAudit) {
    throw new HttpError(422, "The PDF is readable but is not a recognized ORBIT report");
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const integerLine = (value?: string) => Boolean(value && /^\d{1,9}$/.test(value.replaceAll(",", "")));
  const firstMetricLabel = lines.findIndex((line) => /^(URLs discovered|URLs descubiertas|Pages opened|Páginas abiertas)$/i.test(line));
  const valuesFollowLabels = firstMetricLabel >= 0
    && integerLine(lines[firstMetricLabel + 1])
    && !integerLine(lines[firstMetricLabel - 1]);
  const scoreMatch = normalized.match(/(?:Health\s+Score|Posture\s+Score|Final\s+Assessment|Puntuaci[oó]n(?:\s+del)?(?:\s+esc[aá]ner(?:\s+de\s+IA)?|\s+de\s+salud)?)\D{0,40}(\d{1,3})\s*\/\s*100/i);
  const healthScore = scoreMatch ? Number(scoreMatch[1]) : nearbyIntegerForLabels(lines, ["Health Score", "Posture Score", "Puntuación de salud", "Puntuación del escáner de IA transparente"]);
  const labels = {
    urlsDiscovered: ["URLs discovered", "URLs descubiertas"],
    pagesOpened: ["Pages opened", "Páginas abiertas"],
    pagesVisuallyReviewed: ["Pages visually reviewed", "Visual pages", "Páginas visuales", "Páginas revisadas visualmente"],
    visualRegionsInspected: ["Visual regions inspected", "Visual regions", "Regiones visuales", "Regiones visuales inspeccionadas"],
    imagesInspected: ["Images inspected", "Images", "Imágenes", "Imágenes inspeccionadas"],
    categoriesInspected: ["Categories inspected", "Categories", "Categorías", "Categorías inspeccionadas"],
    productsDiscovered: ["Products discovered", "Productos descubiertos"],
    productsVerified: ["Products verified", "Productos verificados"],
    documentsInspected: ["Documents inspected", "Documents", "Documentos", "Documentos inspeccionados"],
    checkoutStatesInspected: ["Checkout states inspected", "Checkout states", "Estados de checkout", "Estados de pago"],
    totalLunaToolCalls: ["Luna tool calls", "Luna tools", "Herramientas Luna"],
  } as const;
  const coverage = Object.fromEntries(Object.entries(labels).flatMap(([key, aliases]) => {
    const value = nearbyIntegerForLabels(lines, [...aliases], valuesFollowLabels);
    return value === undefined ? [] : [[key, value]];
  }));
  const severity = {
    critical: nearbyIntegerForLabels(lines, ["Critical", "Crítico", "Crítica"], valuesFollowLabels) ?? 0,
    high: nearbyIntegerForLabels(lines, ["High", "Alto", "Alta"], valuesFollowLabels) ?? 0,
    medium: nearbyIntegerForLabels(lines, ["Medium", "Medio", "Media"], valuesFollowLabels) ?? 0,
    low: nearbyIntegerForLabels(lines, ["Low", "Bajo", "Baja"], valuesFollowLabels) ?? 0,
  };
  if (healthScore === undefined && Object.keys(coverage).length < 2 && !Object.values(severity).some(Boolean)) {
    throw new HttpError(422, "The ORBIT PDF does not contain enough recognizable report metrics");
  }
  return { source: "ORBIT_REPORT_PDF", pageCount, ...(healthScore === undefined ? {} : { healthScore }), coverage, severity };
}

export async function extractOrbitReportMetrics(bytes: Uint8Array) {
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Next bundles the pdf.js API into .next but does not automatically emit its
  // fake-worker module. Point pdf.js at the installed server-side worker rather
  // than allowing it to resolve a nonexistent .next/server/chunks copy.
  GlobalWorkerOptions.workerSrc = pathToFileURL(join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs")).href;
  const document = await getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false }).promise;
  const lines: string[] = [];
  const tokens: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const grouped = new Map<number, Array<{ x: number; text: string }>>();
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const textItem = item as TextItem;
        const token = textItem.str.trim();
        if (token) tokens.push(token);
        const y = Math.round(textItem.transform[5]);
        const row = grouped.get(y) ?? [];
        row.push({ x: textItem.transform[4], text: textItem.str });
        grouped.set(y, row);
      }
      for (const [, row] of [...grouped].sort(([a], [b]) => b - a)) lines.push(row.sort((a, b) => a.x - b.x).map((item) => item.text).join(" ").trim());
    }
    // Chromium PDFs commonly place several card labels on one visual row and
    // their values on another. Preserve pdf.js content-stream order first so a
    // label remains adjacent to its own value; retain reconstructed visual rows
    // as a secondary representation for prose and inline label/value layouts.
    return parseOrbitReportMetrics(`${tokens.join("\n")}\n${lines.join("\n")}`, document.numPages);
  } finally {
    // pdf.js may reject destroy() with AbortException after its text streams
    // have already completed. Cleanup must never replace a successful parse or
    // the actionable HttpError raised for an unrecognized report.
    await document.destroy().catch(() => undefined);
  }
}
