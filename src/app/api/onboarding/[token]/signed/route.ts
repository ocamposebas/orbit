import { NextResponse, type NextRequest } from "next/server";
import { agreementFromInvitation, publicAgreementState } from "@/contracts/service";
import { sha256 } from "@/contracts/document";
import { SIGNED_CONTRACT_MAX_BYTES, SIGNED_CONTRACT_TYPES } from "@/contracts/schema";
import { apiError, HttpError, validateMutationOrigin } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { getDatabase } from "@/sentinel/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    await enforceRateLimit(request, "agreement-signed-upload", 6);
    validateMutationOrigin(request);
    const { token } = await params;
    const agreement = await agreementFromInvitation(token);
    if (agreement.status === "SIGNED_LOCKED") throw new HttpError(423, "The signed agreement is already stored and permanently locked");
    if (agreement.status !== "CONTRACT_ISSUED" || !agreement.contractPdf) throw new HttpError(409, "Download the issued agreement before uploading the signed copy");
    const formData = await request.formData();
    const file = formData.get("contract");
    if (!(file instanceof File)) throw new HttpError(400, "Choose a signed PDF to upload");
    if (!SIGNED_CONTRACT_TYPES.has(file.type) || !file.name.toLowerCase().endsWith(".pdf")) throw new HttpError(415, "The signed agreement must be a PDF file");
    if (file.size < 100 || file.size > SIGNED_CONTRACT_MAX_BYTES) throw new HttpError(413, "The signed PDF must be smaller than 15 MB");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder("ascii").decode(bytes.slice(0, 5)) !== "%PDF-") throw new HttpError(415, "The uploaded file is not a valid PDF");
    const digest = sha256(bytes);
    const now = new Date();
    const safeOriginalName = file.name.replace(/[\r\n"\\/]/g, "_").slice(0, 180);
    const db = getDatabase();
    await db.$transaction(async (tx) => {
      const updated = await tx.merchantAgreement.updateMany({ where: { id: agreement.id, status: "CONTRACT_ISSUED", signedContract: null }, data: { signedContract: bytes, signedOriginalName: safeOriginalName, signedMimeType: "application/pdf", signedSizeBytes: bytes.byteLength, signedSha256: digest, signedUploadedAt: now, lockedAt: now, status: "SIGNED_LOCKED" } });
      if (updated.count !== 1) throw new HttpError(409, "A signed agreement was already received");
      await tx.auditLog.create({ data: { organizationId: agreement.merchant.organizationId, merchantId: agreement.merchantId, action: "agreement.signed_locked", targetType: "MerchantAgreement", targetId: agreement.id, metadata: { sha256: digest, originalName: safeOriginalName, sizeBytes: bytes.byteLength } } });
    });
    return NextResponse.json({ agreement: publicAgreementState(await agreementFromInvitation(token)) });
  } catch (error) { return apiError(error); }
}
