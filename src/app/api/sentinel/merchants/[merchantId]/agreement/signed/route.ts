import { NextResponse, type NextRequest } from "next/server";
import { safeContractFilename } from "@/contracts/document";
import { readSignedPdf } from "@/contracts/signed-file";
import { apiError, HttpError, requireMerchantAccess } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { getDatabase } from "@/sentinel/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  try {
    await enforceRateLimit(request, "agreement-admin-signed", 20);
    const { merchantId } = await params;
    const { organization } = await requireMerchantAccess(request, merchantId);
    const agreement = await getDatabase().merchantAgreement.findFirst({ where: { merchantId, merchant: { organizationId: organization.id } }, select: { signedContract: true, signedOriginalName: true, signedMimeType: true, legalName: true, merchant: { select: { businessName: true } } } });
    if (!agreement?.signedContract) throw new HttpError(404, "A signed agreement has not been uploaded");
    const name = `orbit-signed-agreement-${safeContractFilename(agreement.legalName ?? agreement.merchant.businessName)}.pdf`;
    return new NextResponse(new Uint8Array(agreement.signedContract), { headers: { "Content-Type": agreement.signedMimeType ?? "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  try {
    await enforceRateLimit(request, "agreement-admin-signed-upload", 10);
    const { merchantId } = await params;
    const { session, organization } = await requireMerchantAccess(request, merchantId, { allowedRoles: ["OWNER", "ADMIN"], mutation: true });
    const agreement = await getDatabase().merchantAgreement.findFirst({ where: { merchantId, merchant: { organizationId: organization.id } } });
    if (!agreement) throw new HttpError(404, "Contractual onboarding was not found");
    if (!["CONTRACT_ISSUED", "SIGNED_LOCKED"].includes(agreement.status) || !agreement.contractPdf) throw new HttpError(409, "Issue the agreement before uploading its signed copy");
    const formData = await request.formData();
    const file = await readSignedPdf(formData.get("contract"));
    if (agreement.signedSha256 === file.digest) throw new HttpError(409, "This signed PDF is already the current custody copy");
    const now = new Date();
    const db = getDatabase();
    const revision = await db.$transaction(async (tx) => {
      const current = await tx.merchantAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
      if (!["CONTRACT_ISSUED", "SIGNED_LOCKED"].includes(current.status) || !current.contractPdf) throw new HttpError(409, "Issue the agreement before uploading its signed copy");
      if (current.signedSha256 === file.digest) throw new HttpError(409, "This signed PDF is already the current custody copy");
      let latest = await tx.signedAgreementRevision.findFirst({ where: { agreementId: current.id }, orderBy: { revision: "desc" }, select: { revision: true } });
      if (!latest && current.signedContract) {
        await tx.signedAgreementRevision.create({ data: {
          agreementId: current.id,
          revision: 1,
          originalName: current.signedOriginalName ?? "signed-agreement.pdf",
          mimeType: current.signedMimeType ?? "application/pdf",
          sizeBytes: current.signedSizeBytes ?? current.signedContract.byteLength,
          contract: current.signedContract,
          sha256: current.signedSha256 ?? "unknown",
          source: "LEGACY",
          uploadedAt: current.signedUploadedAt ?? current.lockedAt ?? current.updatedAt,
        } });
        latest = { revision: 1 };
      }
      const nextRevision = (latest?.revision ?? 0) + 1;
      const created = await tx.signedAgreementRevision.create({ data: {
        agreementId: current.id,
        revision: nextRevision,
        originalName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        contract: file.bytes,
        sha256: file.digest,
        source: "ADMIN",
        uploadedById: session.user.id,
        uploadedAt: now,
      } });
      await tx.merchantAgreement.update({ where: { id: current.id }, data: {
        signedContract: file.bytes,
        signedOriginalName: file.originalName,
        signedMimeType: file.mimeType,
        signedSizeBytes: file.sizeBytes,
        signedSha256: file.digest,
        signedUploadedAt: now,
        lockedAt: current.lockedAt ?? now,
        status: "SIGNED_LOCKED",
      } });
      await tx.auditLog.create({ data: {
        organizationId: organization.id,
        merchantId,
        actorId: session.user.id,
        action: nextRevision === 1 ? "agreement.signed_admin_uploaded" : "agreement.signed_revision_uploaded",
        targetType: "SignedAgreementRevision",
        targetId: created.id,
        metadata: { revision: nextRevision, sha256: file.digest, originalName: file.originalName, sizeBytes: file.sizeBytes, source: "ADMIN", previousSha256: current.signedSha256 },
      } });
      return nextRevision;
    });
    return NextResponse.json({ agreement: { status: "SIGNED_LOCKED", revision, signedOriginalName: file.originalName, signedUploadedAt: now } });
  } catch (error) { return apiError(error); }
}
