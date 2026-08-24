import { NextResponse, type NextRequest } from "next/server";
import { agreementFromInvitation } from "@/contracts/service";
import { renderAgreementPdf, safeContractFilename, sha256 } from "@/contracts/document";
import { apiError, HttpError } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { getDatabase } from "@/sentinel/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    await enforceRateLimit(request, "agreement-contract", 10);
    const { token } = await params;
    let agreement = await agreementFromInvitation(token);
    if (agreement.status === "SIGNED_LOCKED") throw new HttpError(423, "The completed expediente is locked");
    if (agreement.status === "INVITED") throw new HttpError(409, "Complete and certify the merchant information before downloading the agreement");
    let pdf = agreement.contractPdf ? Uint8Array.from(agreement.contractPdf) : null;
    if (!pdf) {
      pdf = Uint8Array.from(await renderAgreementPdf(agreement));
      const now = new Date();
      const digest = sha256(pdf);
      await getDatabase().$transaction(async (tx) => {
        const updated = await tx.merchantAgreement.updateMany({ where: { id: agreement.id, status: "DATA_COMPLETED", contractPdf: null }, data: { contractPdf: pdf, contractSha256: digest, contractIssuedAt: now, status: "CONTRACT_ISSUED" } });
        if (updated.count === 1) await tx.auditLog.create({ data: { organizationId: agreement.merchant.organizationId, merchantId: agreement.merchantId, action: "agreement.contract_issued", targetType: "MerchantAgreement", targetId: agreement.id, metadata: { sha256: digest, termsVersion: agreement.termsVersion } } });
      });
      agreement = await agreementFromInvitation(token);
      pdf = agreement.contractPdf ? Uint8Array.from(agreement.contractPdf) : pdf;
    }
    return new NextResponse(pdf, { headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="orbit-acuerdo-${safeContractFilename(agreement.legalName ?? agreement.merchant.businessName)}.pdf"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return apiError(error); }
}
