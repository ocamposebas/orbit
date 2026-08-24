import { NextResponse, type NextRequest } from "next/server";
import { renderAgreementPdf, safeContractFilename, sha256 } from "@/contracts/document";
import { apiError, HttpError, requireMerchantAccess } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { getDatabase } from "@/sentinel/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  try {
    await enforceRateLimit(request, "agreement-admin-contract", 15);
    const { merchantId } = await params;
    const { organization } = await requireMerchantAccess(request, merchantId);
    let agreement = await getDatabase().merchantAgreement.findFirst({ where: { merchantId, merchant: { organizationId: organization.id } }, include: { merchant: { select: { businessName: true, industry: true } } } });
    if (!agreement) throw new HttpError(404, "Contractual onboarding was not found");
    if (agreement.status === "INVITED") throw new HttpError(409, "The merchant has not completed the required information");
    let pdf = agreement.contractPdf ? Uint8Array.from(agreement.contractPdf) : null;
    if (!pdf) {
      pdf = Uint8Array.from(await renderAgreementPdf(agreement));
      const digest = sha256(pdf);
      const now = new Date();
      const agreementId = agreement.id;
      const termsVersion = agreement.termsVersion;
      await getDatabase().$transaction(async (tx) => {
        const updated = await tx.merchantAgreement.updateMany({ where: { id: agreementId, status: "DATA_COMPLETED", contractPdf: null }, data: { contractPdf: pdf, contractSha256: digest, contractIssuedAt: now, status: "CONTRACT_ISSUED" } });
        if (updated.count === 1) await tx.auditLog.create({ data: { organizationId: organization.id, merchantId, action: "agreement.contract_issued", targetType: "MerchantAgreement", targetId: agreementId, metadata: { sha256: digest, termsVersion, issuedBy: "workspace" } } });
      });
      agreement = await getDatabase().merchantAgreement.findUniqueOrThrow({ where: { id: agreementId }, include: { merchant: { select: { businessName: true, industry: true } } } });
      pdf = agreement.contractPdf ? Uint8Array.from(agreement.contractPdf) : pdf;
    }
    return new NextResponse(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="orbit-acuerdo-${safeContractFilename(agreement.legalName ?? agreement.merchant.businessName)}.pdf"`, "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return apiError(error); }
}
