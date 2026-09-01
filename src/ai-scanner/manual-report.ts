import { createHash } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
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

export type ImportedFinding = {
  title: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  explanation: string;
  remediation: string;
  pageNumber: number;
  priority?: string;
  affectedProduct?: string;
  affectedCategory?: string;
};

export type ImportedProduct = {
  sourceId?: string;
  name: string;
  sku?: string;
  price?: string;
  currency?: string;
  category?: string;
  slug?: string;
  pageNumber: number;
};

export type ImportedDocumentAnalysis = {
  summary: string;
  scoreBreakdown: Record<string, { score: number; maximum: number }>;
  findings: ImportedFinding[];
  products: ImportedProduct[];
  observations: Array<{ text: string; pageNumber: number }>;
  limitations: string[];
};

type ImportedPage = {
  pageNumber: number;
  text: string;
  extraction: "TEXT_LAYER" | "OCR" | "TEXT_LAYER_AND_OCR" | "EMPTY";
  layoutItems?: Array<{ text: string; x: number; y: number }>;
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
  const scoreAfterLabel = normalized.match(/(?:Health\s+Score|Posture\s+Score|Final\s+Assessment|Internal\s+Score|Puntuaci[oó]n(?:\s+del)?(?:\s+esc[aá]ner(?:\s+de\s+IA)?|\s+de\s+salud)?)\D{0,80}(\d{1,3})\s*\/\s*100/i);
  const scoreBeforeLabel = normalized.match(/(\d{1,3})\s*\/\s*100\D{0,80}(?:ORBIT\s+internal\s+health\s+score|Health\s+Score|Posture\s+Score)/i);
  const totalScore = normalized.match(/\bTOTAL\s+(\d{1,3})\s*\/\s*100\b/i);
  const healthScore = scoreAfterLabel ? Number(scoreAfterLabel[1]) : scoreBeforeLabel ? Number(scoreBeforeLabel[1]) : totalScore ? Number(totalScore[1]) : nearbyIntegerForLabels(lines, ["Health Score", "Posture Score", "Puntuación de salud", "Puntuación del escáner de IA transparente"]);
  const labels = {
    urlsDiscovered: ["URLs discovered", "First-party URLs discovered", "URLs descubiertas"],
    pagesOpened: ["Pages opened", "URLs fetched / analyzed", "URLs fetched analyzed", "Páginas abiertas"],
    pagesVisuallyReviewed: ["Pages visually reviewed", "Visual pages", "Páginas visuales", "Páginas revisadas visualmente"],
    visualRegionsInspected: ["Visual regions inspected", "Visual regions", "Regiones visuales", "Regiones visuales inspeccionadas"],
    imagesInspected: ["Images inspected", "Unique product images reviewed", "Images", "Imágenes", "Imágenes inspeccionadas"],
    categoriesInspected: ["Categories inspected", "Categories", "Categorías", "Categorías inspeccionadas"],
    productsDiscovered: ["Products discovered", "Products discovered / reviewed", "Productos descubiertos"],
    productsVerified: ["Products verified", "Products discovered / reviewed", "Products reviewed", "Productos verificados"],
    documentsInspected: ["Documents inspected", "Policies reviewed", "Documents", "Documentos", "Documentos inspeccionados"],
    checkoutStatesInspected: ["Checkout states inspected", "Checkout states", "Estados de checkout", "Estados de pago"],
    totalLunaToolCalls: ["Luna tool calls", "Luna tools", "Herramientas Luna"],
  } as const;
  const coverage = Object.fromEntries(Object.entries(labels).flatMap(([key, aliases]) => {
    const value = nearbyIntegerForLabels(lines, [...aliases], valuesFollowLabels);
    return value === undefined ? [] : [[key, value]];
  }));
  const observedCoverage = normalized.match(/Observed\s+coverage\s+(\d{1,3})\s*%/i);
  if (observedCoverage) coverage.observedCoveragePercent = Number(observedCoverage[1]);
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

function cleanLine(value: string) {
  return value.replace(/^\s*(?:â€¢|•)\s*/, "").replace(/\s+/g, " ").trim();
}

function severityValue(value: string): ImportedFinding["severity"] {
  const upper = value.toUpperCase();
  if (upper.includes("CRITICAL")) return "CRITICAL";
  if (upper.includes("HIGH")) return "HIGH";
  if (upper.includes("MEDIUM")) return "MEDIUM";
  if (upper.includes("LOW")) return "LOW";
  return "INFO";
}

function extractPriorityFindings(pages: ImportedPage[]) {
  const findings: ImportedFinding[] = [];
  for (const page of pages) {
    const lines = page.text.split(/\r?\n/).map(cleanLine).filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^(P[0-3])\s+(.*?)\s+(CRITICAL(?:\s*\/\s*HIGH)?|HIGH|MEDIUM|LOW)\s+(.+)$/i);
      if (!match) continue;
      const remediation = [match[4]];
      for (let following = index + 1; following < lines.length; following += 1) {
        if (/^P[0-3]\s+/i.test(lines[following]) || /ORBIT Sentinel/i.test(lines[following])) break;
        remediation.push(lines[following]);
      }
      const title = match[2].trim();
      const detail = findSupportingDetail(title, pages, page.pageNumber);
      findings.push({
        title,
        severity: severityValue(match[3]),
        priority: match[1].toUpperCase(),
        explanation: detail ?? `The imported report classifies this item as ${match[3].toUpperCase()} with ${match[1].toUpperCase()} remediation priority.`,
        remediation: remediation.join(" ").trim(),
        pageNumber: page.pageNumber,
        affectedProduct: /calculator|policy|affiliate|registration|checkout|seo|index/i.test(title) ? undefined : title,
      });
    }
  }
  return findings.filter((finding, index, all) => all.findIndex((candidate) => candidate.title.toLowerCase() === finding.title.toLowerCase()) === index);
}

function findSupportingDetail(title: string, pages: ImportedPage[], excludedPage: number) {
  const keywords = title.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !["presentation", "product", "flow", "style"].includes(word));
  let best: { score: number; text: string } | undefined;
  for (const page of pages) {
    if (page.pageNumber === excludedPage) continue;
    const paragraphs = page.text.split(/\n(?=(?:P[0-3]\s*\||â€¢|•|[A-Z][A-Z /&-]{5,})\b)/).map(cleanLine).filter(Boolean);
    for (const paragraph of paragraphs) {
      const lower = paragraph.toLowerCase();
      const score = keywords.filter((keyword) => lower.includes(keyword)).length;
      if (score && (!best || score > best.score) && paragraph.length > 40) best = { score, text: paragraph.slice(0, 1_500) };
    }
  }
  return best?.text;
}

function extractGenericFindings(pages: ImportedPage[]) {
  const findings: ImportedFinding[] = [];
  for (const page of pages) {
    const lines = page.text.split(/\r?\n/).map(cleanLine).filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].replaceAll("**", "");
      const match = line.match(/^(?:P[0-3]\s*[|:-]\s*)?(.{3,120}?)\s+(CRITICAL|HIGH|MEDIUM|LOW)(?:\s+(.+))?$/i)
        ?? line.match(/^(?:P[0-3]\s*[|:-]\s*)?(.{3,120}?)\s*[|:-]\s*(CRITICAL|HIGH|MEDIUM|LOW)$/i);
      if (!match) continue;
      const title = match[1].trim();
      if (/^(theme|severity|risk|disposition|finding)$/i.test(title)) continue;
      const context = [match[3], lines[index + 1]].filter(Boolean).join(" ").slice(0, 1_500);
      findings.push({
        title,
        severity: severityValue(match[2]),
        explanation: context || `Imported ${match[2].toUpperCase()} finding on document page ${page.pageNumber}.`,
        remediation: "Review the cited document page and complete the stated corrective action before the next assessment.",
        pageNumber: page.pageNumber,
        affectedProduct: title,
      });
    }
  }
  return findings.filter((finding, index, all) => all.findIndex((candidate) => candidate.title.toLowerCase() === finding.title.toLowerCase()) === index).slice(0, 250);
}

function appendColumn(current: Record<string, string>, key: string, value: string, joiner = " ") {
  const cleaned = value.trim();
  if (!cleaned) return;
  current[key] = current[key] ? `${current[key]}${joiner}${cleaned}` : cleaned;
}

function extractLayoutProducts(pages: ImportedPage[]) {
  const products: ImportedProduct[] = [];
  for (const page of pages) {
    if (!/Complete product inventory/i.test(page.text) || !page.layoutItems?.length) continue;
    let current: Record<string, string> | undefined;
    const flush = () => {
      if (!current?.sourceId || !current.name) return;
      const slug = current.slug?.replace(/[`\s]/g, "").replace(/^[-–—]+|[-–—]+$/g, "");
      products.push({
        sourceId: current.sourceId,
        name: current.name.trim(),
        ...(current.sku && current.sku !== "-" ? { sku: current.sku.trim() } : {}),
        ...(current.price ? { price: current.price.trim(), currency: current.price.includes("$") ? "USD" : undefined } : {}),
        ...(current.category && current.category !== "-" ? { category: current.category.trim() } : {}),
        ...(slug ? { slug } : {}),
        pageNumber: page.pageNumber,
      });
    };
    for (const item of page.layoutItems) {
      if (item.y < 50) continue;
      const value = item.text.trim();
      if (!value) continue;
      if (item.x >= 45 && item.x < 75 && /^\d{2,9}$/.test(value)) {
        flush();
        current = { sourceId: value, name: "" };
        continue;
      }
      if (!current) continue;
      if (item.x >= 75 && item.x < 240) appendColumn(current, "name", value);
      else if (item.x >= 240 && item.x < 310) appendColumn(current, "sku", value, "");
      else if (item.x >= 310 && item.x < 380) appendColumn(current, "price", value);
      else if (item.x >= 380 && item.x < 470) appendColumn(current, "category", value);
      else if (item.x >= 470) appendColumn(current, "slug", value, "");
    }
    flush();
  }
  return products;
}

function extractScoreBreakdown(pages: ImportedPage[]) {
  const breakdown: Record<string, { score: number; maximum: number }> = {};
  for (const page of pages) {
    if (!/(?:Score|Puntuaci[oó]n)[\s\S]*(?:limitations|breakdown|composition)|DOMAIN\s+SCORE/i.test(page.text)) continue;
    for (const rawLine of page.text.split(/\r?\n/)) {
      const match = cleanLine(rawLine).match(/^(.{3,100}?)\s+(\d{1,3})\s*\/\s*(\d{1,3})$/);
      if (!match || /^(?:TOTAL|ORBIT Sentinel)/i.test(match[1])) continue;
      breakdown[match[1].trim()] = { score: Number(match[2]), maximum: Number(match[3]) };
    }
  }
  return breakdown;
}

function extractLimitations(pages: ImportedPage[]) {
  const limitations: string[] = [];
  for (const page of pages) {
    const lines = page.text.split(/\r?\n/);
    let collecting = false;
    for (const rawLine of lines) {
      const line = cleanLine(rawLine);
      if (/^(NOT OBSERVED|Method & limitations|Limitations)$/i.test(line)) { collecting = true; continue; }
      if (!collecting || !line || /ORBIT Sentinel/i.test(line)) continue;
      if (/^(?:[A-Z][A-Z /&-]{5,}|\d{1,2})$/.test(line) && !/NOT OBSERVED/i.test(line)) break;
      if (rawLine.match(/(?:â€¢|•)/) || /not observed|excluded|could not|unable|remain/i.test(line)) limitations.push(line);
    }
  }
  return [...new Set(limitations)].slice(0, 100);
}

function analysisFromJson(text: string, pages: ImportedPage[]): ImportedDocumentAnalysis {
  const parsed = validateJson(text);
  const root = typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  const findingsValue = root.findings ?? objectAt(parsed, ["report", "findings"]) ?? objectAt(parsed, ["assessment", "findings"]) ?? objectAt(parsed, ["data", "findings"]);
  const rawFindings = Array.isArray(findingsValue) ? findingsValue : [];
  const findings = rawFindings.flatMap((value, index): ImportedFinding[] => {
    if (typeof value !== "object" || value === null) return [];
    const item = value as Record<string, unknown>;
    const title = String(item.title ?? item.name ?? `Imported finding ${index + 1}`).trim();
    return [{ title, severity: severityValue(String(item.severity ?? "INFO")), explanation: String(item.explanation ?? item.description ?? item.reason ?? title), remediation: String(item.remediation ?? item.recommendedAction ?? item.recommendation ?? "Review and remediate this imported finding."), pageNumber: Number(item.pageNumber ?? 1) || 1, affectedProduct: typeof item.affectedProduct === "string" ? item.affectedProduct : undefined, affectedCategory: typeof item.affectedCategory === "string" ? item.affectedCategory : undefined }];
  });
  const productsValue = root.products ?? objectAt(parsed, ["report", "products"]) ?? objectAt(parsed, ["assessment", "products"]) ?? objectAt(parsed, ["data", "products"]);
  const rawProducts = Array.isArray(productsValue) ? productsValue : [];
  const products = rawProducts.flatMap((value): ImportedProduct[] => {
    if (typeof value !== "object" || value === null) return [];
    const item = value as Record<string, unknown>;
    const name = String(item.name ?? item.title ?? "").trim();
    if (!name) return [];
    return [{ name, sourceId: item.id === undefined ? undefined : String(item.id), sku: item.sku === undefined ? undefined : String(item.sku), price: item.price === undefined ? undefined : String(item.price), currency: item.currency === undefined ? undefined : String(item.currency), category: item.category === undefined ? undefined : String(item.category), slug: item.slug === undefined ? undefined : String(item.slug), pageNumber: Number(item.pageNumber ?? 1) || 1 }];
  });
  const scoreBreakdown = root.scoreBreakdown ?? objectAt(parsed, ["report", "scoreBreakdown"]) ?? objectAt(parsed, ["metrics", "scoreBreakdown"]);
  const limitations = root.limitations ?? objectAt(parsed, ["report", "limitations"]) ?? objectAt(parsed, ["assessment", "limitations"]);
  const summary = root.summary ?? objectAt(parsed, ["report", "summary"]) ?? objectAt(parsed, ["assessment", "summary"]);
  return { summary: String(summary ?? `Imported JSON documented with ${findings.length} findings and ${products.length} products.`), scoreBreakdown: typeof scoreBreakdown === "object" && scoreBreakdown !== null ? scoreBreakdown as ImportedDocumentAnalysis["scoreBreakdown"] : {}, findings, products, observations: pages.map((page) => ({ text: page.text, pageNumber: page.pageNumber })), limitations: Array.isArray(limitations) ? limitations.map(String) : [], };
}

export function analyzeImportedDocument(pages: ImportedPage[], metrics: ImportedReportMetrics, jsonText?: string): ImportedDocumentAnalysis {
  if (jsonText !== undefined) return analysisFromJson(jsonText, pages);
  const priorityFindings = extractPriorityFindings(pages);
  const findings = priorityFindings.length ? priorityFindings : extractGenericFindings(pages);
  const products = extractLayoutProducts(pages);
  const observations = pages.filter((page) => page.text.trim()).map((page) => ({ text: page.text.trim().slice(0, 5_000), pageNumber: page.pageNumber }));
  const summary = `Imported document fully indexed: ${metrics.pageCount} page${metrics.pageCount === 1 ? "" : "s"}, ${products.length} product${products.length === 1 ? "" : "s"}, and ${findings.length} prioritized finding${findings.length === 1 ? "" : "s"}${metrics.healthScore === undefined ? "." : `; reported score ${metrics.healthScore}/100.`}`;
  return { summary, scoreBreakdown: extractScoreBreakdown(pages), findings, products, observations, limitations: extractLimitations(pages) };
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
  const layoutItems: Array<{ text: string; x: number; y: number }> = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null || !("str" in item)) continue;
    const textItem = item as TextItem;
    if (textItem.str.trim()) tokens.push(textItem.str.trim());
    const y = Math.round(textItem.transform[5]);
    layoutItems.push({ text: textItem.str, x: textItem.transform[4], y: textItem.transform[5] });
    const row = grouped.get(y) ?? [];
    row.push({ x: textItem.transform[4], text: textItem.str });
    grouped.set(y, row);
  }
  const visualLines = [...grouped].sort(([a], [b]) => b - a).map(([, row]) => row.sort((a, b) => a.x - b.x).map((item) => item.text).join(" ").trim()).filter(Boolean);
  return { tokens, text: visualLines.join("\n") || tokens.join("\n"), layoutItems };
}

async function importPdfDocument(bytes: Uint8Array) {
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  GlobalWorkerOptions.workerSrc = pathToFileURL(join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs")).href;
  return getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false, standardFontDataUrl: join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts") + sep }).promise;
}

async function renderPageForOcr(page: PDFPageProxy) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const viewport = page.getViewport({ scale: 2 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  await page.render({ canvasContext: context as never, viewport }).promise;
  return canvas.toBuffer("image/png");
}

function needsOcr(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length < 500) return true;
  const readable = [...compact].filter((character) => /[\p{L}\p{N}\p{P}\p{Z}]/u.test(character)).length;
  return compact.includes("�") || readable / compact.length < 0.82;
}

export async function extractOrbitReport(bytes: Uint8Array) {
  const document = await importPdfDocument(bytes);
  const pages: ImportedPage[] = [];
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
      if (needsOcr(layer.text)) {
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
        layoutItems: layer.layoutItems,
      });
      page.cleanup();
    }
    const fullText = pages.map((page) => `PAGE ${page.pageNumber}\n${page.text}`).join("\n\n");
    const metrics = bestAvailableMetrics(`${metricTokens.join("\n")}\n${fullText}`, document.numPages, "IMPORTED_PDF");
    metrics.characterCount = fullText.length;
    metrics.textLayerPageCount = textLayerPageCount;
    metrics.ocrPageCount = ocrPageCount;
    const analysis = analyzeImportedDocument(pages, metrics);
    metrics.severity = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const finding of analysis.findings) {
      const key = finding.severity.toLowerCase();
      if (key in metrics.severity) metrics.severity[key as keyof typeof metrics.severity] += 1;
    }
    if (analysis.products.length) {
      metrics.coverage.productsDiscovered ??= analysis.products.length;
      metrics.coverage.productsVerified ??= analysis.products.length;
      metrics.coverage.categoriesInspected ??= new Set(analysis.products.map((product) => product.category).filter(Boolean)).size;
    }
    return { metrics, pages, fullText, analysis };
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
  const pages: ImportedPage[] = chunks.map((chunk) => ({ pageNumber: chunk.chunkNumber, text: chunk.text, extraction: "TEXT_LAYER" as const }));
  return {
    metrics,
    fullText,
    pages,
    analysis: analyzeImportedDocument(pages, metrics, upload.kind === "JSON" ? fullText : undefined),
  };
}

export async function extractOrbitReportMetrics(bytes: Uint8Array) {
  return (await extractOrbitReport(bytes)).metrics;
}
