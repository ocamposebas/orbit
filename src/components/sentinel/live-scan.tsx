"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Download,
  ExternalLink,
  Eye,
  LoaderCircle,
  Play,
  ScanLine,
  UploadCloud,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { sentinelFetch } from "./client";

type Usage = { totalTokens?: number; approximateCostUsd?: number };
type Coverage = {
  urlsDiscovered?: string[];
  pagesOpened?: string[];
  pagesVisuallyReviewed?: string[];
  visualRegionsInspected?: number;
  imagesInspected?: number;
  categoriesInspected?: string[];
  productsDiscovered?: number;
  productsVerified?: number;
  documentsInspected?: string[];
  checkoutStatesInspected?: string[];
  totalLunaToolCalls?: number;
  auditRuntimeMs?: number;
  tokenUsage?: Usage;
};
type Finding = {
  id: string;
  title: string;
  severity: string;
  confidence: number;
  theme: string;
  affectedUrl: string;
  affectedProduct?: string;
  affectedCategory?: string;
  verifiedSku?: string;
  explanation: string;
  remediation: string;
};
type ToolEvent = {
  id: string;
  name: string;
  status: string;
  evidenceCount: number;
  durationMs?: number;
  error?: string;
  startedAt: string;
};
type ImportedCoverage = {
  urlsDiscovered?: number;
  pagesOpened?: number;
  pagesVisuallyReviewed?: number;
  visualRegionsInspected?: number;
  imagesInspected?: number;
  categoriesInspected?: number;
  productsDiscovered?: number;
  productsVerified?: number;
  documentsInspected?: number;
  checkoutStatesInspected?: number;
  totalLunaToolCalls?: number;
  observedCoveragePercent?: number;
};
type ImportedMetrics = {
  healthScore?: number;
  coverage?: ImportedCoverage;
  severity?: {
    critical?: number;
    high?: number;
    medium?: number;
    low?: number;
  };
  pageCount?: number;
  textLayerPageCount?: number;
  ocrPageCount?: number;
};
type ImportedDocument = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: string;
  pageCount: number;
  characterCount: number;
  ocrPageCount: number;
  source: string;
  active: boolean;
};
type Scan = {
  id: string;
  merchantId: string;
  status: string;
  model: string;
  resumeAvailable?: boolean;
  importedReportOriginalName?: string;
  importedReportUploadedAt?: string;
  importedReportMetrics?: ImportedMetrics;
  importedDocuments?: ImportedDocument[];
  score?: number;
  summary?: string;
  observations?: Array<{ text: string; evidenceIds: string[] }>;
  coverage?: Coverage;
  usage?: Usage;
  limitations?: string[];
  error?: string;
  createdAt: string;
  completedAt?: string;
  merchant: { businessName: string };
  site: { normalizedUrl: string; hostname: string };
  findings: Finding[];
  products: Array<{
    id: string;
    name: string;
    sku?: string;
    price?: string;
    currency?: string;
    canonicalUrl: string;
    verified: boolean;
  }>;
  toolEvents: ToolEvent[];
};
const terminal = new Set([
  "COMPLETED",
  "AI_SCAN_FAILED",
  "AI_SCAN_INCOMPLETE",
  "CANCELLED",
]);

export function LiveScan({ scanId }: { scanId: string }) {
  const [scan, setScan] = useState<Scan>();
  const [error, setError] = useState("");
  const [resuming, setResuming] = useState(false);
  const [pollGeneration, setPollGeneration] = useState(0);
  const [uploadingReport, setUploadingReport] = useState(false);
  const [notice, setNotice] = useState("");
  const [showPasteImport, setShowPasteImport] = useState(false);
  const [manualText, setManualText] = useState("");
  const [manualFormat, setManualFormat] = useState<"text" | "json">("text");
  const fileInput = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    try {
      const data = await sentinelFetch<{ scan: Scan }>(
        `/api/ai-scanner/scans/${scanId}`,
      );
      setScan(data.scan);
      setError("");
      return data.scan;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to load AI scan",
      );
    }
  }, [scanId]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const current = await load();
      if (active && current && !terminal.has(current.status))
        timer = setTimeout(poll, 1_500);
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [load, pollGeneration]);
  const resume = async () => {
    setResuming(true);
    try {
      await sentinelFetch(`/api/ai-scanner/scans/${scanId}/resume`, {
        method: "POST",
      });
      setScan((current) =>
        current
          ? {
              ...current,
              status: "QUEUED",
              resumeAvailable: false,
              error: undefined,
              completedAt: undefined,
            }
          : current,
      );
      setError("");
      setPollGeneration((value) => value + 1);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to resume AI scan",
      );
    } finally {
      setResuming(false);
    }
  };
  const uploadManualReport = async (file?: File, pastedContent?: string) => {
    if (!file && !pastedContent?.trim()) return;
    if (file && file.size > 25 * 1024 * 1024) {
      setError("The imported document must be smaller than 25 MB");
      return;
    }
    setUploadingReport(true);
    setNotice("");
    try {
      const body = new FormData();
      if (file) body.set("report", file);
      else {
        body.set("content", pastedContent ?? "");
        body.set("format", manualFormat);
      }
      await sentinelFetch(`/api/ai-scanner/scans/${scanId}/manual-report`, {
        method: "POST",
        body,
      });
      await load();
      setError("");
      setManualText("");
      setShowPasteImport(false);
      setNotice(
        "Saved - this document is now the current assessment. Only its active findings remain open; previous imports stay available in history.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to import the document",
      );
    } finally {
      setUploadingReport(false);
    }
  };
  if (!scan && !error)
    return (
      <div className="grid min-h-[calc(100dvh-56px)] place-items-center">
        <LoaderCircle className="size-5 animate-spin text-[#8588ef]" />
      </div>
    );
  if (!scan) return <div className="p-8 text-xs text-[#d68b8b]">{error}</div>;
  const importedMetrics = scan.importedReportMetrics ?? {};
  const importedCoverage = importedMetrics.coverage ?? {};
  const hasImportedReport = Boolean(scan.importedReportUploadedAt);
  const retainedCoverage = scan.coverage ?? {};
  const countList = (count?: number) =>
    Array.from({ length: count ?? 0 }, () => "imported");
  const coverage: Coverage = hasImportedReport
    ? {
        urlsDiscovered: countList(importedCoverage.urlsDiscovered),
        pagesOpened: countList(importedCoverage.pagesOpened),
        pagesVisuallyReviewed: countList(
          importedCoverage.pagesVisuallyReviewed,
        ),
        visualRegionsInspected: importedCoverage.visualRegionsInspected,
        imagesInspected: importedCoverage.imagesInspected,
        categoriesInspected: countList(importedCoverage.categoriesInspected),
        productsDiscovered: importedCoverage.productsDiscovered,
        productsVerified: importedCoverage.productsVerified,
        documentsInspected: countList(importedCoverage.documentsInspected),
        checkoutStatesInspected: countList(
          importedCoverage.checkoutStatesInspected,
        ),
        totalLunaToolCalls: importedCoverage.totalLunaToolCalls,
      }
    : retainedCoverage;
  const displayedScore = importedMetrics.healthScore ?? scan.score;
  const running = !terminal.has(scan.status);
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-7 sm:px-7 lg:px-10 lg:py-10">
      <Link
        href={`/sentinel/merchant/${scan.merchantId}`}
        className="inline-flex items-center gap-1.5 text-[10px] text-[#6b6f77] hover:text-[#b8bab5]"
      >
        <ArrowLeft className="size-3" />
        Merchant
      </Link>
      <header className="mt-5 flex flex-col gap-4 border-b border-white/[.07] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[.16em] text-[#8588ef]">
            ORBIT AI Scanner v1
          </p>
          <h1 className="mt-2 text-2xl font-medium tracking-[-.04em]">
            {scan.merchant.businessName}
          </h1>
          <a
            href={scan.site.normalizedUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-[10px] text-[#747881]"
          >
            {scan.site.hostname}
            <ExternalLink className="size-2.5" />
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 text-[10px] text-[#858991]">
            {running ? (
              <LoaderCircle className="size-3.5 animate-spin text-[#8588ef]" />
            ) : scan.status === "COMPLETED" ? (
              <Check className="size-3.5 text-[#70c79e]" />
            ) : (
              <AlertTriangle className="size-3.5 text-[#d88989]" />
            )}
            {scan.status.replaceAll("_", " ")}
          </span>
          {scan.resumeAvailable && (
            <button
              type="button"
              onClick={() => void resume()}
              disabled={resuming}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-[#8588ef] px-3 text-[10px] font-medium text-white disabled:opacity-60"
            >
              {resuming ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : (
                <Play className="size-3" />
              )}
              Resume scan
            </button>
          )}
          <button
            type="button"
            disabled={uploadingReport}
            onClick={() => fileInput.current?.click()}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-white/[.1] px-3 text-[10px] disabled:opacity-60"
          >
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,application/json,text/plain,.pdf,.json,.txt"
              className="sr-only"
              disabled={uploadingReport}
              onChange={(event) => {
                void uploadManualReport(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            {uploadingReport ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <UploadCloud className="size-3" />
            )}
            Add PDF / JSON / TXT
          </button>
          <button
            type="button"
            disabled={uploadingReport}
            onClick={() => setShowPasteImport((value) => !value)}
            className="inline-flex h-9 items-center rounded-md border border-white/[.1] px-3 text-[10px] disabled:opacity-60"
          >
            Paste text / JSON
          </button>
          {scan.importedReportUploadedAt && (
            <a
              href={`/api/ai-scanner/scans/${scan.id}/manual-report`}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-[#70c79e]/25 px-3 text-[10px] text-[#8bd5ae]"
            >
              <Download className="size-3" />
              Active document
            </a>
          )}
          {scan.completedAt && (
            <a
              href={`/api/ai-scanner/scans/${scan.id}/report`}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-white/[.1] px-3 text-[10px]"
            >
              <Download className="size-3" />
              Generated report
            </a>
          )}
        </div>
      </header>
      {showPasteImport && (
        <section className="mt-5 border border-[#8588ef]/20 bg-[#8588ef]/[.04] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-[#d2d4cf]">
                Paste the complete document
              </p>
              <p className="mt-1 text-[9px] text-[#666b74]">
                The original content is stored intact and indexed in
                50,000-character units.
              </p>
            </div>
            <div className="flex rounded-md border border-white/[.1] p-0.5">
              {(["text", "json"] as const).map((format) => (
                <button
                  key={format}
                  type="button"
                  onClick={() => setManualFormat(format)}
                  className={`rounded px-3 py-1.5 text-[9px] uppercase ${manualFormat === format ? "bg-white/[.1] text-white" : "text-[#696e77]"}`}
                >
                  {format}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={manualText}
            onChange={(event) => setManualText(event.target.value)}
            placeholder={
              manualFormat === "json"
                ? "Paste valid JSON here…"
                : "Paste all document text here…"
            }
            className="mt-4 min-h-48 w-full resize-y rounded-md border border-white/[.1] bg-black/30 p-3 font-mono text-[10px] leading-5 text-[#c8cac5] outline-none focus:border-[#8588ef]/50"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowPasteImport(false);
                setManualText("");
              }}
              className="h-9 rounded-md border border-white/[.1] px-3 text-[10px]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={uploadingReport || !manualText.trim()}
              onClick={() => void uploadManualReport(undefined, manualText)}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-[#8588ef] px-4 text-[10px] font-medium text-white disabled:opacity-50"
            >
              {uploadingReport && (
                <LoaderCircle className="size-3 animate-spin" />
              )}
              Save complete content
            </button>
          </div>
        </section>
      )}
      {error && (
        <div className="mt-5 border border-[#d77979]/20 bg-[#d77979]/5 p-4 text-xs text-[#d99494]">
          {error}
        </div>
      )}
      {scan.error && (
        <div className="mt-5 border border-[#d77979]/20 bg-[#d77979]/5 p-4 text-xs text-[#d99494]">
          {scan.error}
        </div>
      )}
      {notice && (
        <div className="mt-5 border border-[#70c79e]/25 bg-[#70c79e]/[.07] p-4 text-xs text-[#9bd7b8]">
          {notice}
        </div>
      )}
      {(scan.importedDocuments?.length ?? 0) > 0 && (
        <section className="mt-5 border border-white/[.075] bg-[#0c0e12]">
          <div className="border-b border-white/[.06] px-5 py-4">
            <p className="text-[9px] font-semibold uppercase tracking-[.14em] text-[#696e77]">
              Documented import history
            </p>
            <p className="mt-1 text-[9px] text-[#555a62]">
              Every source remains downloadable; importing a newer document does
              not delete earlier evidence or scans.
            </p>
          </div>
          <div className="divide-y divide-white/[.055]">
            {scan.importedDocuments?.map((document) => (
              <div
                key={document.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-[10px] text-[#c3c5c0]">
                    {document.originalName}
                    {document.active && (
                      <span className="ml-2 text-[8px] uppercase tracking-[.1em] text-[#70c79e]">
                        Active
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-[8px] text-[#5d626a]">
                    {new Date(document.uploadedAt).toLocaleString()} ·{" "}
                    {(document.sizeBytes / 1_048_576).toFixed(2)} MB ·{" "}
                    {document.pageCount} indexed unit
                    {document.pageCount === 1 ? "" : "s"} ·{" "}
                    {document.characterCount.toLocaleString()} characters
                    {document.ocrPageCount
                      ? ` · OCR on ${document.ocrPageCount} page${document.ocrPageCount === 1 ? "" : "s"}`
                      : ""}
                  </p>
                  <p className="mt-1 truncate font-mono text-[8px] text-[#454951]">
                    SHA-256 {document.sha256}
                  </p>
                </div>
                <a
                  href={`/api/ai-scanner/scans/${scan.id}/manual-report?evidenceId=${encodeURIComponent(document.id)}`}
                  className="inline-flex h-8 items-center justify-center gap-2 rounded border border-white/[.09] px-3 text-[9px] text-[#aeb0ab] sm:ml-auto"
                >
                  <Download className="size-3" />
                  Download source
                </a>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="mt-6 border border-white/[.075] bg-[#0c0e12] p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[9px] uppercase tracking-[.14em] text-[#666b74]">
              {hasImportedReport
                ? "Imported document analysis"
                : "Luna audit session"}
            </p>
            <p className="mt-1 text-xs text-[#c9cbc6]">
              {running
                ? "Luna is choosing the next read-only investigation step."
                : (scan.summary ??
                  "The audit ended without a complete summary.")}
            </p>
            {scan.importedReportUploadedAt && (
              <p className="mt-2 text-[9px] text-[#8bd5ae]">
                Imported document active · {scan.importedReportOriginalName} ·{" "}
                {importedMetrics.pageCount ?? 0} indexed units
              </p>
            )}
          </div>
          <span className="font-mono text-[9px] text-[#666b74]">
            {scan.model}
          </span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-px bg-white/[.06] sm:grid-cols-4 lg:grid-cols-6">
          {[
            ["Pages opened", coverage.pagesOpened?.length ?? 0],
            ["Visual pages", coverage.pagesVisuallyReviewed?.length ?? 0],
            ["Visual regions", coverage.visualRegionsInspected ?? 0],
            ["Images", coverage.imagesInspected ?? 0],
            ["Categories", coverage.categoriesInspected?.length ?? 0],
            ["Products verified", coverage.productsVerified ?? 0],
            ["Documents", coverage.documentsInspected?.length ?? 0],
            ["Checkout states", coverage.checkoutStatesInspected?.length ?? 0],
            ["Luna tools", coverage.totalLunaToolCalls ?? 0],
            ["Runtime", formatMs(coverage.auditRuntimeMs ?? 0)],
            ["Tokens", coverage.tokenUsage?.totalTokens ?? 0],
            [
              "Approx. cost",
              `$${Number(coverage.tokenUsage?.approximateCostUsd ?? 0).toFixed(4)}`,
            ],
          ].map(([label, value]) => (
            <div key={label} className="bg-[#0c0e12] p-4">
              <p className="text-[9px] text-[#5f646c]">{label}</p>
              <p className="mt-2 font-mono text-sm text-[#d2d4cf]">{value}</p>
            </div>
          ))}
        </div>
        {scan.importedReportUploadedAt && (
          <div className="mt-4">
            <p className="mb-2 text-[9px] font-semibold uppercase tracking-[.12em] text-[#70c79e]">
              Imported report snapshot ·{" "}
              {importedMetrics.pageCount ?? "Unknown"} pages
            </p>
            <div className="grid grid-cols-3 gap-px bg-[#70c79e]/15 sm:grid-cols-6">
              {[
                ["Report score", importedMetrics.healthScore ?? "Not present"],
                [
                  "Observed coverage",
                  importedCoverage.observedCoveragePercent === undefined
                    ? "Not present"
                    : `${importedCoverage.observedCoveragePercent}%`,
                ],
                ["PDF pages", importedMetrics.pageCount ?? "Not present"],
                ["Text-layer pages", importedMetrics.textLayerPageCount ?? 0],
                ["OCR pages", importedMetrics.ocrPageCount ?? 0],
                [
                  "URLs discovered",
                  importedCoverage.urlsDiscovered ?? "Not present",
                ],
                ["Pages opened", importedCoverage.pagesOpened ?? "Not present"],
                ["Images", importedCoverage.imagesInspected ?? "Not present"],
                [
                  "Categories",
                  importedCoverage.categoriesInspected ?? "Not present",
                ],
                [
                  "Products discovered",
                  importedCoverage.productsDiscovered ?? "Not present",
                ],
                [
                  "Products verified",
                  importedCoverage.productsVerified ?? "Not present",
                ],
                [
                  "Documents",
                  importedCoverage.documentsInspected ?? "Not present",
                ],
                [
                  "Checkout states",
                  importedCoverage.checkoutStatesInspected ?? "Not present",
                ],
                ["Critical", importedMetrics.severity?.critical ?? 0],
                ["High", importedMetrics.severity?.high ?? 0],
                ["Medium", importedMetrics.severity?.medium ?? 0],
                ["Low", importedMetrics.severity?.low ?? 0],
              ].map(([label, value]) => (
                <div key={label} className="bg-[#0c0e12] p-3">
                  <p className="text-[8px] uppercase tracking-[.08em] text-[#5f776b]">
                    {label}
                  </p>
                  <p className="mt-1 font-mono text-sm text-[#9bd7b8]">
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="mt-4 text-[9px] leading-4 text-[#555a62]">
          {hasImportedReport
            ? "Every indexed page is retained as evidence; the values above and corrections below come from the active imported document."
            : "Luna activity belongs to the retained browser session."}
        </p>
      </section>
      <div className="mt-7 grid gap-7 lg:grid-cols-[.85fr_1.15fr]">
        <section>
          <div className="flex items-center gap-2">
            <ScanLine className="size-4 text-[#8588ef]" />
            <h2 className="text-sm font-medium">Luna activity</h2>
          </div>
          <div className="mt-3 border border-white/[.075] bg-[#0c0e12]">
            {scan.toolEvents.length ? (
              scan.toolEvents.slice(0, 30).map((event) => (
                <div
                  key={event.id}
                  className="border-b border-white/[.055] p-3 last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`size-1.5 rounded-full ${event.status === "COMPLETED" ? "bg-[#6fc69d]" : event.status === "FAILED" ? "bg-[#d98282]" : "animate-pulse bg-[#8588ef]"}`}
                    />
                    <span className="text-[10px] text-[#a5a8a1]">
                      {event.name.replaceAll("_", " ")}
                    </span>
                    <span className="ml-auto font-mono text-[9px] text-[#555a62]">
                      {event.evidenceCount} evidence · {event.durationMs ?? 0}{" "}
                      ms
                    </span>
                  </div>
                  {event.status === "FAILED" && event.error && (
                    <p className="mt-2 break-words pl-4 text-[9px] leading-4 text-[#b87373]">
                      {event.error}
                    </p>
                  )}
                </div>
              ))
            ) : (
              <p className="p-5 text-[10px] text-[#62666f]">
                Waiting for Luna to request its first tool.
              </p>
            )}
          </div>
        </section>
        <section>
          <div className="flex items-center gap-2">
            <Eye className="size-4 text-[#8588ef]" />
            <h2 className="text-sm font-medium">Validated findings</h2>
          </div>
          <div className="mt-3 space-y-3">
            {scan.findings.length ? (
              scan.findings.map((finding) => (
                <article
                  key={finding.id}
                  className="border border-white/[.075] bg-[#0c0e12] p-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-semibold tracking-[.1em] text-[#d48d76]">
                      {finding.severity}
                    </span>
                    <span className="font-mono text-[9px] text-[#5d626a]">
                      {Math.round(finding.confidence * 100)}%
                    </span>
                  </div>
                  <h3 className="mt-2 text-xs text-[#d3d5d0]">
                    {finding.title}
                  </h3>
                  <p className="mt-2 text-[10px] leading-5 text-[#777b84]">
                    {finding.explanation}
                  </p>
                  <a
                    href={finding.affectedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 block break-all text-[9px] text-[#8588ef]"
                  >
                    {finding.affectedUrl}
                  </a>
                  <p className="mt-3 text-[9px] text-[#62666f]">
                    Product: {finding.affectedProduct ?? "Not applicable"} ·
                    Category: {finding.affectedCategory ?? "Not applicable"} ·
                    SKU: {finding.verifiedSku ?? "Not observed"}
                  </p>
                  <p className="mt-3 border-t border-white/[.06] pt-3 text-[10px] leading-5 text-[#999c96]">
                    <b>Remediation:</b> {finding.remediation}
                  </p>
                </article>
              ))
            ) : (
              <div className="border border-white/[.075] bg-[#0c0e12] p-5 text-[10px] text-[#62666f]">
                {running
                  ? "Findings appear only after Luna submits evidence-backed structured conclusions."
                  : "No validated finding was produced from the evidence Luna reviewed."}
              </div>
            )}
          </div>
        </section>
      </div>
      {hasImportedReport && (
        <section className="mt-8">
          <div className="flex items-center gap-2">
            <ScanLine className="size-4 text-[#70c79e]" />
            <h2 className="text-sm font-medium">
              Imported product inventory · {scan.products.length}
            </h2>
          </div>
          <div className="mt-3 grid gap-px bg-white/[.06] sm:grid-cols-2 lg:grid-cols-3">
            {scan.products.length ? (
              scan.products.map((product) => (
                <a
                  key={product.id}
                  href={product.canonicalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-[#0c0e12] p-4 hover:bg-white/[.025]"
                >
                  <p className="text-[10px] text-[#c9cbc6]">{product.name}</p>
                  <p className="mt-2 font-mono text-[8px] text-[#62666f]">
                    SKU {product.sku ?? "Not exposed"} · {product.price ?? "Price not exposed"} {product.currency ?? ""}
                  </p>
                </a>
              ))
            ) : (
              <p className="bg-[#0c0e12] p-5 text-[10px] text-[#62666f]">
                No structured product rows were present in this document.
              </p>
            )}
          </div>
        </section>
      )}
      {!running && (
        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="text-sm font-medium">
              {hasImportedReport ? "Document pages" : "Luna observations"}
            </h2>
            <div className="mt-3 space-y-2">
              {(scan.observations ?? []).map((item, index) => (
                <div key={index} className="border border-white/[.07] p-3">
                  <p className="text-[10px] leading-5 text-[#92968f]">
                    {item.text}
                  </p>
                  <p className="mt-1 font-mono text-[8px] text-[#555a62]">
                    {item.evidenceIds.join(", ")}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h2 className="text-sm font-medium">Limitations</h2>
            <ul className="mt-3 space-y-2 text-[10px] leading-5 text-[#777b84]">
              {(scan.limitations ?? []).length ? (
                (scan.limitations ?? []).map((item) => (
                  <li key={item} className="border-b border-white/[.055] pb-2">
                    {item}
                  </li>
                ))
              ) : (
                <li>
                  No explicit limitation was returned; unobserved surfaces
                  remain unknown.
                </li>
              )}
            </ul>
            {displayedScore !== undefined && (
              <div className="mt-6 border border-white/[.075] bg-[#0c0e12] p-5">
                <p className="text-[9px] uppercase tracking-[.14em] text-[#666b74]">
                  {importedMetrics.healthScore !== undefined
                    ? "Imported report Health Score"
                    : "Transparent AI Scanner score"}
                </p>
                <p className="mt-2 text-3xl">
                  {displayedScore}
                  <span className="text-sm text-[#666b74]"> / 100</span>
                </p>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function formatMs(value: number) {
  const seconds = Math.round(value / 1000);
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
