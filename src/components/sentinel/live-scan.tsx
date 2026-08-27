"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeft, Check, Download, ExternalLink, Eye, LoaderCircle, Play, ScanLine, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { sentinelFetch } from "./client";

type Usage = { totalTokens?: number; approximateCostUsd?: number };
type Coverage = { urlsDiscovered?: string[]; pagesOpened?: string[]; pagesVisuallyReviewed?: string[]; visualRegionsInspected?: number; imagesInspected?: number; categoriesInspected?: string[]; productsDiscovered?: number; productsVerified?: number; documentsInspected?: string[]; checkoutStatesInspected?: string[]; totalLunaToolCalls?: number; auditRuntimeMs?: number; tokenUsage?: Usage };
type Finding = { id: string; title: string; severity: string; confidence: number; theme: string; affectedUrl: string; affectedProduct?: string; affectedCategory?: string; verifiedSku?: string; explanation: string; remediation: string };
type ToolEvent = { id: string; name: string; status: string; evidenceCount: number; durationMs?: number; error?: string; startedAt: string };
type ImportedCoverage = { urlsDiscovered?: number; pagesOpened?: number; pagesVisuallyReviewed?: number; visualRegionsInspected?: number; imagesInspected?: number; categoriesInspected?: number; productsDiscovered?: number; productsVerified?: number; documentsInspected?: number; checkoutStatesInspected?: number; totalLunaToolCalls?: number };
type ImportedMetrics = { healthScore?: number; coverage?: ImportedCoverage; severity?: { critical?: number; high?: number; medium?: number; low?: number }; pageCount?: number };
type Scan = { id: string; merchantId: string; status: string; model: string; resumeAvailable?: boolean; importedReportOriginalName?: string; importedReportUploadedAt?: string; importedReportMetrics?: ImportedMetrics; score?: number; summary?: string; observations?: Array<{ text: string; evidenceIds: string[] }>; coverage?: Coverage; usage?: Usage; limitations?: string[]; error?: string; createdAt: string; completedAt?: string; merchant: { businessName: string }; site: { normalizedUrl: string; hostname: string }; findings: Finding[]; products: Array<{ id: string; name: string; sku?: string; price?: string; currency?: string; canonicalUrl: string; verified: boolean }>; toolEvents: ToolEvent[] };
const terminal = new Set(["COMPLETED", "AI_SCAN_FAILED", "AI_SCAN_INCOMPLETE", "CANCELLED"]);

export function LiveScan({ scanId }: { scanId: string }) {
  const [scan, setScan] = useState<Scan>();
  const [error, setError] = useState("");
  const [resuming, setResuming] = useState(false);
  const [pollGeneration, setPollGeneration] = useState(0);
  const [uploadingReport, setUploadingReport] = useState(false);
  const load = useCallback(async () => {
    try { const data = await sentinelFetch<{ scan: Scan }>(`/api/ai-scanner/scans/${scanId}`); setScan(data.scan); setError(""); return data.scan; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load AI scan"); }
  }, [scanId]);
  useEffect(() => { let active = true; let timer: ReturnType<typeof setTimeout>; const poll = async () => { const current = await load(); if (active && current && !terminal.has(current.status)) timer = setTimeout(poll, 1_500); }; void poll(); return () => { active = false; clearTimeout(timer); }; }, [load, pollGeneration]);
  const resume = async () => {
    setResuming(true);
    try {
      await sentinelFetch(`/api/ai-scanner/scans/${scanId}/resume`, { method: "POST" });
      setScan((current) => current ? { ...current, status: "QUEUED", resumeAvailable: false, error: undefined, completedAt: undefined } : current);
      setError("");
      setPollGeneration((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to resume AI scan");
    } finally {
      setResuming(false);
    }
  };
  const uploadManualReport = async (file?: File) => {
    if (!file) return;
    setUploadingReport(true);
    try {
      const body = new FormData();
      body.set("report", file);
      await sentinelFetch(`/api/ai-scanner/scans/${scanId}/manual-report`, { method: "POST", body });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to import the PDF report");
    } finally {
      setUploadingReport(false);
    }
  };
  if (!scan && !error) return <div className="grid min-h-[calc(100dvh-56px)] place-items-center"><LoaderCircle className="size-5 animate-spin text-[#8588ef]" /></div>;
  if (!scan) return <div className="p-8 text-xs text-[#d68b8b]">{error}</div>;
  const importedMetrics = scan.importedReportMetrics ?? {};
  const coverage = scan.coverage ?? {};
  const importedCoverage = importedMetrics.coverage ?? {};
  const displayedScore = importedMetrics.healthScore ?? scan.score;
  const running = !terminal.has(scan.status);
  return <div className="mx-auto max-w-[1280px] px-4 py-7 sm:px-7 lg:px-10 lg:py-10">
    <Link href={`/sentinel/merchant/${scan.merchantId}`} className="inline-flex items-center gap-1.5 text-[10px] text-[#6b6f77] hover:text-[#b8bab5]"><ArrowLeft className="size-3" />Merchant</Link>
    <header className="mt-5 flex flex-col gap-4 border-b border-white/[.07] pb-6 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-[#8588ef]">ORBIT AI Scanner v1</p><h1 className="mt-2 text-2xl font-medium tracking-[-.04em]">{scan.merchant.businessName}</h1><a href={scan.site.normalizedUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[10px] text-[#747881]">{scan.site.hostname}<ExternalLink className="size-2.5" /></a></div><div className="flex flex-wrap items-center gap-3"><span className="inline-flex items-center gap-2 text-[10px] text-[#858991]">{running ? <LoaderCircle className="size-3.5 animate-spin text-[#8588ef]" /> : scan.status === "COMPLETED" ? <Check className="size-3.5 text-[#70c79e]" /> : <AlertTriangle className="size-3.5 text-[#d88989]" />}{scan.status.replaceAll("_", " ")}</span>{scan.resumeAvailable && <button type="button" onClick={() => void resume()} disabled={resuming} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#8588ef] px-3 text-[10px] font-medium text-white disabled:opacity-60">{resuming ? <LoaderCircle className="size-3 animate-spin" /> : <Play className="size-3" />}Resume scan</button>}<label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-white/[.1] px-3 text-[10px]"><input type="file" accept="application/pdf,.pdf" className="sr-only" disabled={uploadingReport} onChange={(event) => { void uploadManualReport(event.target.files?.[0]); event.currentTarget.value = ""; }} />{uploadingReport ? <LoaderCircle className="size-3 animate-spin" /> : <UploadCloud className="size-3" />}{scan.importedReportUploadedAt ? "Replace report" : "Upload report"}</label>{scan.importedReportUploadedAt && <a href={`/api/ai-scanner/scans/${scan.id}/manual-report`} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#70c79e]/25 px-3 text-[10px] text-[#8bd5ae]"><Download className="size-3" />Imported report</a>}{scan.completedAt && <a href={`/api/ai-scanner/scans/${scan.id}/report`} className="inline-flex h-9 items-center gap-2 rounded-md border border-white/[.1] px-3 text-[10px]"><Download className="size-3" />Generated report</a>}</div></header>
    {error && <div className="mt-5 border border-[#d77979]/20 bg-[#d77979]/5 p-4 text-xs text-[#d99494]">{error}</div>}
    {scan.error && <div className="mt-5 border border-[#d77979]/20 bg-[#d77979]/5 p-4 text-xs text-[#d99494]">{scan.error}</div>}
    <section className="mt-6 border border-white/[.075] bg-[#0c0e12] p-5"><div className="flex items-center justify-between"><div><p className="text-[9px] uppercase tracking-[.14em] text-[#666b74]">Luna audit session</p><p className="mt-1 text-xs text-[#c9cbc6]">{running ? "Luna is choosing the next read-only investigation step." : scan.summary ?? "The audit ended without a complete summary."}</p>{scan.importedReportUploadedAt && <p className="mt-2 text-[9px] text-[#8bd5ae]">Imported report metrics active · {scan.importedReportOriginalName} · {importedMetrics.pageCount ?? 0} pages</p>}</div><span className="font-mono text-[9px] text-[#666b74]">{scan.model}</span></div><div className="mt-5 grid grid-cols-2 gap-px bg-white/[.06] sm:grid-cols-4 lg:grid-cols-6">{[
      ["Pages opened", importedCoverage.pagesOpened ?? coverage.pagesOpened?.length ?? 0], ["Visual pages", importedCoverage.pagesVisuallyReviewed ?? coverage.pagesVisuallyReviewed?.length ?? 0], ["Visual regions", importedCoverage.visualRegionsInspected ?? coverage.visualRegionsInspected ?? 0], ["Images", importedCoverage.imagesInspected ?? coverage.imagesInspected ?? 0], ["Categories", importedCoverage.categoriesInspected ?? coverage.categoriesInspected?.length ?? 0], ["Products verified", importedCoverage.productsVerified ?? coverage.productsVerified ?? 0], ["Documents", importedCoverage.documentsInspected ?? coverage.documentsInspected?.length ?? 0], ["Checkout states", importedCoverage.checkoutStatesInspected ?? coverage.checkoutStatesInspected?.length ?? 0], ["Luna tools", importedCoverage.totalLunaToolCalls ?? coverage.totalLunaToolCalls ?? 0], ["Runtime", formatMs(coverage.auditRuntimeMs ?? 0)], ["Tokens", coverage.tokenUsage?.totalTokens ?? 0], ["Approx. cost", `$${Number(coverage.tokenUsage?.approximateCostUsd ?? 0).toFixed(4)}`],
    ].map(([label, value]) => <div key={label} className="bg-[#0c0e12] p-4"><p className="text-[9px] text-[#5f646c]">{label}</p><p className="mt-2 font-mono text-sm text-[#d2d4cf]">{value}</p></div>)}</div>{scan.importedReportUploadedAt && <div className="mt-4 grid grid-cols-3 gap-px bg-[#70c79e]/15 sm:grid-cols-6">{[["Report score", importedMetrics.healthScore ?? "—"], ["URLs discovered", importedCoverage.urlsDiscovered ?? "—"], ["Products discovered", importedCoverage.productsDiscovered ?? "—"], ["Critical", importedMetrics.severity?.critical ?? 0], ["High", importedMetrics.severity?.high ?? 0], ["Medium / Low", `${importedMetrics.severity?.medium ?? 0} / ${importedMetrics.severity?.low ?? 0}`]].map(([label, value]) => <div key={label} className="bg-[#0c0e12] p-3"><p className="text-[8px] uppercase tracking-[.08em] text-[#5f776b]">{label}</p><p className="mt-1 font-mono text-sm text-[#9bd7b8]">{value}</p></div>)}</div>}<p className="mt-4 text-[9px] leading-4 text-[#555a62]">Coverage reports actual investigation activity. Imported values retain report provenance and do not claim new browser activity.</p></section>
    <div className="mt-7 grid gap-7 lg:grid-cols-[.85fr_1.15fr]"><section><div className="flex items-center gap-2"><ScanLine className="size-4 text-[#8588ef]" /><h2 className="text-sm font-medium">Luna activity</h2></div><div className="mt-3 border border-white/[.075] bg-[#0c0e12]">{scan.toolEvents.length ? scan.toolEvents.slice(0, 30).map((event) => <div key={event.id} className="border-b border-white/[.055] p-3 last:border-0"><div className="flex items-center gap-3"><span className={`size-1.5 rounded-full ${event.status === "COMPLETED" ? "bg-[#6fc69d]" : event.status === "FAILED" ? "bg-[#d98282]" : "animate-pulse bg-[#8588ef]"}`} /><span className="text-[10px] text-[#a5a8a1]">{event.name.replaceAll("_", " ")}</span><span className="ml-auto font-mono text-[9px] text-[#555a62]">{event.evidenceCount} evidence · {event.durationMs ?? 0} ms</span></div>{event.status === "FAILED" && event.error && <p className="mt-2 break-words pl-4 text-[9px] leading-4 text-[#b87373]">{event.error}</p>}</div>) : <p className="p-5 text-[10px] text-[#62666f]">Waiting for Luna to request its first tool.</p>}</div></section><section><div className="flex items-center gap-2"><Eye className="size-4 text-[#8588ef]" /><h2 className="text-sm font-medium">Validated findings</h2></div><div className="mt-3 space-y-3">{scan.findings.length ? scan.findings.map((finding) => <article key={finding.id} className="border border-white/[.075] bg-[#0c0e12] p-4"><div className="flex items-center justify-between"><span className="text-[9px] font-semibold tracking-[.1em] text-[#d48d76]">{finding.severity}</span><span className="font-mono text-[9px] text-[#5d626a]">{Math.round(finding.confidence * 100)}%</span></div><h3 className="mt-2 text-xs text-[#d3d5d0]">{finding.title}</h3><p className="mt-2 text-[10px] leading-5 text-[#777b84]">{finding.explanation}</p><a href={finding.affectedUrl} target="_blank" rel="noreferrer" className="mt-2 block break-all text-[9px] text-[#8588ef]">{finding.affectedUrl}</a><p className="mt-3 text-[9px] text-[#62666f]">Product: {finding.affectedProduct ?? "Not applicable"} · Category: {finding.affectedCategory ?? "Not applicable"} · SKU: {finding.verifiedSku ?? "Not observed"}</p><p className="mt-3 border-t border-white/[.06] pt-3 text-[10px] leading-5 text-[#999c96]"><b>Remediation:</b> {finding.remediation}</p></article>) : <div className="border border-white/[.075] bg-[#0c0e12] p-5 text-[10px] text-[#62666f]">{running ? "Findings appear only after Luna submits evidence-backed structured conclusions." : "No validated finding was produced from the evidence Luna reviewed."}</div>}</div></section></div>
    {!running && <section className="mt-8 grid gap-6 lg:grid-cols-2"><div><h2 className="text-sm font-medium">Luna observations</h2><div className="mt-3 space-y-2">{(scan.observations ?? []).map((item, index) => <div key={index} className="border border-white/[.07] p-3"><p className="text-[10px] leading-5 text-[#92968f]">{item.text}</p><p className="mt-1 font-mono text-[8px] text-[#555a62]">{item.evidenceIds.join(", ")}</p></div>)}</div></div><div><h2 className="text-sm font-medium">Limitations</h2><ul className="mt-3 space-y-2 text-[10px] leading-5 text-[#777b84]">{(scan.limitations ?? []).length ? (scan.limitations ?? []).map((item) => <li key={item} className="border-b border-white/[.055] pb-2">{item}</li>) : <li>No explicit limitation was returned; unobserved surfaces remain unknown.</li>}</ul>{displayedScore !== undefined && <div className="mt-6 border border-white/[.075] bg-[#0c0e12] p-5"><p className="text-[9px] uppercase tracking-[.14em] text-[#666b74]">{importedMetrics.healthScore !== undefined ? "Imported report Health Score" : "Transparent AI Scanner score"}</p><p className="mt-2 text-3xl">{displayedScore}<span className="text-sm text-[#666b74]"> / 100</span></p></div>}</div></section>}
  </div>;
}

function formatMs(value: number) { const seconds = Math.round(value / 1000); return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`; }
