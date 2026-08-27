import { createHash } from "node:crypto";
import { HttpError } from "@/sentinel/http";

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
