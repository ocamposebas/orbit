import { NextResponse, type NextRequest } from "next/server";
import { safeContractFilename } from "@/contracts/document";
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
