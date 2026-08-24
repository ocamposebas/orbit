import { NextResponse, type NextRequest } from "next/server";
import { agreementFromInvitation, INVITATION_VALIDITY_DAYS, publicAgreementState } from "@/contracts/service";
import { merchantAgreementIntakeSchema } from "@/contracts/schema";
import { apiError, HttpError, validateMutationOrigin } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { getDatabase } from "@/sentinel/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    await enforceRateLimit(request, "agreement-invitation-read", 60);
    const { token } = await params;
    return NextResponse.json({ agreement: publicAgreementState(await agreementFromInvitation(token)) }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    await enforceRateLimit(request, "agreement-intake", 12);
    validateMutationOrigin(request);
    const { token } = await params;
    const agreement = await agreementFromInvitation(token);
    if (agreement.status === "SIGNED_LOCKED") throw new HttpError(423, "This agreement is signed and permanently locked");
    if (agreement.status !== "INVITED") throw new HttpError(409, "The merchant information was already certified and can no longer be edited");
    const input = merchantAgreementIntakeSchema.parse(await request.json());
    const now = new Date();
    const db = getDatabase();
    await db.$transaction(async (tx) => {
      const updated = await tx.merchantAgreement.updateMany({
        where: { id: agreement.id, status: "INVITED" },
        data: {
          legalName: input.legalName,
          tradeName: input.tradeName,
          entityType: input.entityType,
          taxId: input.taxId,
          registrationNumber: input.registrationNumber,
          businessAddress: input.businessAddress,
          city: input.city,
          region: input.region,
          postalCode: input.postalCode,
          countryCode: input.countryCode,
          coveredDomains: input.coveredDomains,
          primaryContactName: input.primaryContactName,
          primaryContactRole: input.primaryContactRole,
          primaryContactEmail: input.primaryContactEmail,
          primaryContactPhone: input.primaryContactPhone,
          billingDescriptor: input.billingDescriptor,
          estimatedMonthlyVolume: input.estimatedMonthlyVolume,
          averageTransactionAmount: input.averageTransactionAmount,
          highestTransactionAmount: input.highestTransactionAmount,
          productsAndServices: input.productsAndServices,
          informationCertifiedAt: now,
          invitationExpiresAt: new Date(now.getTime() + INVITATION_VALIDITY_DAYS * 86_400_000),
          status: "DATA_COMPLETED",
        },
      });
      if (updated.count !== 1) throw new HttpError(409, "The merchant information was already submitted");
      await tx.auditLog.create({ data: {
        organizationId: agreement.merchant.organizationId,
        merchantId: agreement.merchantId,
        action: "agreement.information_certified",
        targetType: "MerchantAgreement",
        targetId: agreement.id,
        metadata: { termsVersion: agreement.termsVersion, contactEmail: input.primaryContactEmail },
      } });
    });
    const refreshed = await agreementFromInvitation(token);
    return NextResponse.json({ agreement: publicAgreementState(refreshed) });
  } catch (error) { return apiError(error); }
}
