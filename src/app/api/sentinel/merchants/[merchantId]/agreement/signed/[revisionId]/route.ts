import { NextResponse, type NextRequest } from "next/server";
import { safeContractFilename } from "@/contracts/document";
import { apiError, HttpError, requireMerchantAccess } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { getDatabase } from "@/sentinel/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ merchantId: string; revisionId: string }> }) {
  try {
    await enforceRateLimit(request, "agreement-admin-signed-revision", 30);
    const { merchantId, revisionId } = await params;
    const { organization } = await requireMerchantAccess(request, merchantId);
    const revision = await getDatabase().signedAgreementRevision.findFirst({
      where: { id: revisionId, agreement: { merchantId, merchant: { organizationId: organization.id } } },
      select: { revision: true, contract: true, mimeType: true, agreement: { select: { legalName: true, merchant: { select: { businessName: true } } } } },
    });
    if (!revision) throw new HttpError(404, "Signed agreement revision was not found");
    const business = safeContractFilename(revision.agreement.legalName ?? revision.agreement.merchant.businessName);
    return new NextResponse(new Uint8Array(revision.contract), { headers: {
      "Content-Type": revision.mimeType,
      "Content-Disposition": `attachment; filename="orbit-signed-agreement-${business}-v${revision.revision}.pdf"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return apiError(error); }
}
