import { sha256 } from "./document";
import { SIGNED_CONTRACT_MAX_BYTES, SIGNED_CONTRACT_TYPES } from "./schema";
import { HttpError } from "@/sentinel/http";

export async function readSignedPdf(value: FormDataEntryValue | null) {
  if (!(value instanceof File)) throw new HttpError(400, "Choose a signed PDF to upload");
  if (!SIGNED_CONTRACT_TYPES.has(value.type) || !value.name.toLowerCase().endsWith(".pdf")) throw new HttpError(415, "The signed agreement must be a PDF file");
  if (value.size < 100 || value.size > SIGNED_CONTRACT_MAX_BYTES) throw new HttpError(413, "The signed PDF must be smaller than 15 MB");
  const bytes = new Uint8Array(await value.arrayBuffer());
  if (new TextDecoder("ascii").decode(bytes.slice(0, 5)) !== "%PDF-") throw new HttpError(415, "The uploaded file is not a valid PDF");
  return {
    bytes,
    digest: sha256(bytes),
    mimeType: "application/pdf",
    originalName: value.name.replace(/[\r\n"\\/]/g, "_").slice(0, 180),
    sizeBytes: bytes.byteLength,
  };
}
