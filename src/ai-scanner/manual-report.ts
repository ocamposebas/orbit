import { createHash } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { HttpError } from "@/sentinel/http";
import type { PDFPageProxy, TextItem } from "pdfjs-dist/types/src/display/api";

export const AI_SCAN_MANUAL_REPORT_MAX_BYTES = 25 * 1024 * 1024;
const MAX_EVIDENCE_CHARS = 50_000;
const packageRequire = createRequire(import.meta.url);

export type ManualImportKind = "PDF" | "TEXT" | "JSON";

export type ImportedReportMetrics = {
  source: "ORBIT_REPORT_PDF" | "IMPORTED_PDF" | "IMPORTED_TEXT" | "IMPORTED_JSON";
  pageCount: number;
  characterCount?: number;
  textLayerPageCount?: number;
  ocrPageCount?: number;
  healthScore?: number;
  coverage: Record<string, number>;
  severity: Record<"critical" | "high" | "medium" | "low", number>;
};

export type ValidatedManualImport = {
  bytes: Uint8Array;
  sha256: string;
  originalName: string;
  mimeType: "application/pdf" | "application/json" | "text/plain";
  kind: ManualImportKind;
  text?: string;
};

function safeImportName(name: string) {
  return name.replace(/[\r\n"\\/]/g, "_").slice(0, 180);
}

function decodeUtf8(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new HttpError(415, "The text document must use valid UTF-8 encoding");
  }
}

function validateJson(text: string) {
  try { return JSON.parse(text) as unknown; }
  catch { throw new HttpError(422, "The JSON document is not valid JSON"); }
}

function finalizeTextImport(bytes: Uint8Array, originalName: string, kind: "TEXT" | "JSON"): ValidatedManualImport {
  if (!bytes.byteLength || bytes.byteLength > AI_SCAN_MANUAL_REPORT_MAX_BYTES) throw new HttpError(413, "The text or JSON document must be between 1 byte and 25 MB");
  const text = decodeUtf8(bytes);
  if (!text.trim()) throw new HttpError(422, "The text or JSON document cannot be empty");
  if (kind === "JSON") validateJson(text);
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    originalName: safeImportName(originalName),
    mimeType: kind === "JSON" ? "application/json" : "text/plain",
    kind,
    text,
  };
}

export async function validateAiScanManualImport(input: { file?: unknown; text?: unknown; format?: unknown }) {
  const hasFile = input.file instanceof File && input.file.size > 0;
  const hasText = typeof input.text === "string" && input.text.length > 0;
  if (hasFile && hasText) throw new HttpError(400, "Upload a document or paste content, not both at the same time");
  if (!hasFile && !hasText) throw new HttpError(400, "Choose a PDF, JSON, or TXT document, or paste the complete content");

  if (hasText) {
    const kind = input.format === "json" ? "JSON" : "TEXT";
    const bytes = new TextEncoder().encode(input.text as string);
    return finalizeTextImport(bytes, kind === "JSON" ? "pasted-information.json" : "pasted-information.txt", kind);
  }

  const file = input.file as File;
  if (file.size > AI_SCAN_MANUAL_REPORT_MAX_BYTES) throw new HttpError(413, "The imported document must be smaller than 25 MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const lowerName = file.name.toLowerCase();
  const looksLikePdf = new TextDecoder("ascii").decode(bytes.slice(0, 5)) === "%PDF-";
  const isPdf = looksLikePdf || file.type === "application/pdf" || lowerName.endsWith(".pdf");
  if (isPdf) {
    if (!looksLikePdf) throw new HttpError(415, "The uploaded file does not have a valid PDF header");
    if (bytes.byteLength < 100) throw new HttpError(415, "The uploaded PDF is incomplete");
    const trailer = new TextDecoder("ascii").decode(bytes.slice(Math.max(0, bytes.length - 4_096)));
    if (!trailer.includes("%%EOF")) throw new HttpError(415, "The uploaded PDF is incomplete or missing its end marker");
    return {
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      originalName: safeImportName(file.name),
      mimeType: "application/pdf" as const,
      kind: "PDF" as const,
    };
  }

  const isJson = file.type === "application/json" || lowerName.endsWith(".json");
  const isText = file.type === "text/plain" || lowerName.endsWith(".txt") || lowerName.endsWith(".text");
  if (!isJson && !isText) throw new HttpError(415, "Only PDF, JSON, and plain-text documents are supported");
  return finalizeTextImport(bytes, file.name, isJson ? "JSON" : "TEXT");
}

// Narrow compatibility helper for existing callers.
export async function validateAiScanManualReport(file: unknown) {
  const upload = await validateAiScanManualImport({ file });
  if (upload.kind !== "PDF") throw new HttpError(415, "The manual report must be a PDF file");
  return upload;
}

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
  // OCR commonly confuses the capital I in "AI" with l, L, 1, or i.
  const orbitScannerReport = /\bORBIT\b/i.test(normalized) && /(A[IiLl1]\s+SCANNER|ESC[AÁ]NER DE IA|SENTINEL)/i.test(normalized);
  const postRemediationAudit = /\bWEB AUDIT\b/i.test(normalized) && /(POST[- ]REMEDIATION|VALIDATION)/i.test(normalized);
  if (!orbitScannerReport && !postRemediationAudit) throw new HttpError(422, "The document is readable but is not a recognized ORBIT report");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const integerLine = (value?: string) => Boolean(value && /^\d{1,9}$/.test(value.replaceAll(",", "")));
  const firstMetricLabel = lines.findIndex((line) => /^(URLs discovered|URLs descubiertas|Pages opened|Páginas abiertas)$/i.test(line));
  const valuesFollowLabels = firstMetricLabel >= 0 && integerLine(lines[firstMetricLabel + 1]) && !integerLine(lines[firstMetricLabel - 1]);
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
  if (healthScore === undefined && Object.keys(coverage).length < 2 && !Object.values(severity).some(Boolean)) throw new HttpError(422, "The ORBIT document does not contain enough recognizable report metrics");
  return { source: "ORBIT_REPORT_PDF", pageCount, ...(healthScore === undefined ? {} : { healthScore }), coverage, severity };
}

function genericMetrics(source: ImportedReportMetrics["source"], pageCount: number, characterCount: number): ImportedReportMetrics {
  return { source, pageCount, characterCount, coverage: {}, severity: { critical: 0, high: 0, medium: 0, low: 0 } };
}

function objectAt(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null || !(key in current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function numberAt(value: unknown, paths: string[][]) {
  for (const path of paths) {
    const candidate = objectAt(value, path);
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  return undefined;
}

function metricsFromJson(text: string): ImportedReportMetrics {
  const parsed = validateJson(text);
  const metrics = genericMetrics("IMPORTED_JSON", 1, text.length);
  const healthScore = numberAt(parsed, [["healthScore"], ["score"], ["metrics", "healthScore"], ["report", "healthScore"], ["importedReportMetrics", "healthScore"]]);
  const coverageObject = objectAt(parsed, ["coverage"]) ?? objectAt(parsed, ["metrics", "coverage"]) ?? objectAt(parsed, ["report", "coverage"]);
  if (typeof coverageObject === "object" && coverageObject !== null) {
    metrics.coverage = Object.fromEntries(Object.entries(coverageObject).flatMap(([key, value]) => {
      if (typeof value === "number" && Number.isFinite(value)) return [[key, value]];
      if (Array.isArray(value)) return [[key, value.length]];
      return [];
    }));
  }
  const severityObject = objectAt(parsed, ["severity"]) ?? objectAt(parsed, ["metrics", "severity"]);
  if (typeof severityObject === "object" && severityObject !== null) {
    for (const key of ["critical", "high", "medium", "low"] as const) {
      const value = (severityObject as Record<string, unknown>)[key];
      if (typeof value === "number" && Number.isFinite(value)) metrics.severity[key] = value;
    }
  } else {
    const findings = objectAt(parsed, ["findings"]);
    if (Array.isArray(findings)) for (const finding of findings) {
      const severity = typeof finding === "object" && finding !== null ? String((finding as Record<string, unknown>).severity ?? "").toLowerCase() : "";
      if (severity in metrics.severity) metrics.severity[severity as keyof typeof metrics.severity] += 1;
    }
  }
  if (healthScore !== undefined) metrics.healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));
  return metrics;
}

function bestAvailableMetrics(text: string, pageCount: number, fallbackSource: ImportedReportMetrics["source"]) {
  try { return parseOrbitReportMetrics(text, pageCount); }
  catch (error) {
    if (!(error instanceof HttpError) || error.status !== 422) throw error;
    return genericMetrics(fallbackSource, pageCount, text.length);
  }
}

async function prepareOcrLanguageDirectory() {
  const languageDirectory = join(tmpdir(), "orbit-tesseract-languages-v1");
  await mkdir(languageDirectory, { recursive: true });
  for (const language of ["eng", "spa"] as const) {
    const packageRoot = dirname(packageRequire.resolve(`@tesseract.js-data/${language}/package.json`));
    await copyFile(join(packageRoot, "4.0.0_best_int", `${language}.traineddata.gz`), join(languageDirectory, `${language}.traineddata.gz`));
  }
  return languageDirectory;
}

async function createOcrWorker() {
  const [{ createWorker }, languageDirectory] = await Promise.all([import("tesseract.js"), prepareOcrLanguageDirectory()]);
  return createWorker(["eng", "spa"], 1, {
    langPath: languageDirectory,
    cachePath: join(tmpdir(), "orbit-tesseract-cache"),
    gzip: true,
    // Tesseract otherwise throws inside its child-process event callback and
    // terminates the entire Next.js process before the import route can report
    // a normal extraction error.
    errorHandler: () => undefined,
  });
}

function textLayerFromItems(items: readonly unknown[]) {
  const grouped = new Map<number, Array<{ x: number; text: string }>>();
  const tokens: string[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null || !("str" in item)) continue;
    const textItem = item as TextItem;
    if (textItem.str.trim()) tokens.push(textItem.str.trim());
    const y = Math.round(textItem.transform[5]);
    const row = grouped.get(y) ?? [];
    row.push({ x: textItem.transform[4], text: textItem.str });
    grouped.set(y, row);
  }
  const visualLines = [...grouped].sort(([a], [b]) => b - a).map(([, row]) => row.sort((a, b) => a.x - b.x).map((item) => item.text).join(" ").trim()).filter(Boolean);
  return { tokens, text: visualLines.join("\n") || tokens.join("\n") };
}

async function importPdfDocument(bytes: Uint8Array) {
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  GlobalWorkerOptions.workerSrc = pathToFileURL(join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs")).href;
  return getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false }).promise;
}

async function renderPageForOcr(page: PDFPageProxy) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const viewport = page.getViewport({ scale: 2 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  await page.render({ canvasContext: context as never, viewport }).promise;
  return canvas.toBuffer("image/png");
}

export async function extractOrbitReport(bytes: Uint8Array) {
  const document = await importPdfDocument(bytes);
  const pages: Array<{ pageNumber: number; text: string; extraction: "TEXT_LAYER" | "OCR" | "TEXT_LAYER_AND_OCR" | "EMPTY" }> = [];
  const metricTokens: string[] = [];
  let worker: Awaited<ReturnType<typeof createOcrWorker>> | undefined;
  let ocrPageCount = 0;
  let textLayerPageCount = 0;
  try {
    if (document.numPages < 1) throw new HttpError(422, "The PDF does not contain any pages");
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ includeMarkedContent: true });
      const layer = textLayerFromItems(content.items);
      metricTokens.push(...layer.tokens);
      if (layer.text.trim()) textLayerPageCount += 1;

      let ocrText = "";
      // Sparse text layers often contain only a page number, watermark, or
      // invisible accessibility fragment while the real page is a scan.
      if (layer.text.replace(/\s+/g, " ").trim().length < 500) {
        worker ??= await createOcrWorker();
        const image = await renderPageForOcr(page);
        const result = await worker.recognize(image);
        ocrText = result.data.text.replace(/\r\n/g, "\n").trim();
        if (ocrText) ocrPageCount += 1;
      }
      const combined = layer.text && ocrText ? `${layer.text}\n\n[OCR TEXT]\n${ocrText}` : layer.text || ocrText;
      pages.push({
        pageNumber,
        text: combined,
        extraction: layer.text && ocrText ? "TEXT_LAYER_AND_OCR" : ocrText ? "OCR" : layer.text ? "TEXT_LAYER" : "EMPTY",
      });
      page.cleanup();
    }
    const fullText = pages.map((page) => `PAGE ${page.pageNumber}\n${page.text}`).join("\n\n");
    const metrics = bestAvailableMetrics(`${metricTokens.join("\n")}\n${fullText}`, document.numPages, "IMPORTED_PDF");
    metrics.characterCount = fullText.length;
    metrics.textLayerPageCount = textLayerPageCount;
    metrics.ocrPageCount = ocrPageCount;
    return { metrics, pages, fullText };
  } finally {
    await worker?.terminate().catch(() => undefined);
    await document.destroy().catch(() => undefined);
  }
}

export function splitImportedText(text: string) {
  if (!text.length) return [];
  const chunks: Array<{ chunkNumber: number; text: string }> = [];
  for (let offset = 0; offset < text.length; offset += MAX_EVIDENCE_CHARS) chunks.push({ chunkNumber: chunks.length + 1, text: text.slice(offset, offset + MAX_EVIDENCE_CHARS) });
  return chunks;
}

export async function extractManualImport(upload: ValidatedManualImport) {
  if (upload.kind === "PDF") return extractOrbitReport(upload.bytes);
  const fullText = upload.text ?? decodeUtf8(upload.bytes);
  const chunks = splitImportedText(fullText);
  const metrics = upload.kind === "JSON" ? metricsFromJson(fullText) : bestAvailableMetrics(fullText, chunks.length || 1, "IMPORTED_TEXT");
  metrics.pageCount = chunks.length || 1;
  metrics.characterCount = fullText.length;
  return {
    metrics,
    fullText,
    pages: chunks.map((chunk) => ({ pageNumber: chunk.chunkNumber, text: chunk.text, extraction: "TEXT_LAYER" as const })),
  };
}

export async function extractOrbitReportMetrics(bytes: Uint8Array) {
  return (await extractOrbitReport(bytes)).metrics;
}
