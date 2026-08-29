import { NextResponse, type NextRequest } from "next/server";
import { agreementFromInvitation, publicAgreementState } from "@/contracts/service";
import { readSignedPdf } from "@/contracts/signed-file";
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
    const { bytes, digest, mimeType, originalName, sizeBytes } = await readSignedPdf(formData.get("contract"));
    const now = new Date();
    const db = getDatabase();
    await db.$transaction(async (tx) => {
      const updated = await tx.merchantAgreement.updateMany({ where: { id: agreement.id, status: "CONTRACT_ISSUED", signedContract: null }, data: { signedContract: bytes, signedOriginalName: originalName, signedMimeType: mimeType, signedSizeBytes: sizeBytes, signedSha256: digest, signedUploadedAt: now, lockedAt: now, status: "SIGNED_LOCKED" } });
      if (updated.count !== 1) throw new HttpError(409, "A signed agreement was already received");
      await tx.signedAgreementRevision.create({ data: { agreementId: agreement.id, revision: 1, originalName, mimeType, sizeBytes, contract: bytes, sha256: digest, source: "CUSTOMER" } });
      await tx.auditLog.create({ data: { organizationId: agreement.merchant.organizationId, merchantId: agreement.merchantId, action: "agreement.signed_locked", targetType: "MerchantAgreement", targetId: agreement.id, metadata: { revision: 1, sha256: digest, originalName, sizeBytes, source: "CUSTOMER" } } });
    });
    return NextResponse.json({ agreement: publicAgreementState(await agreementFromInvitation(token)) });
  } catch (error) { return apiError(error); }
}
