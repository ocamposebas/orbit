import { createHash, randomBytes } from "node:crypto";
import { getServerEnv } from "@/sentinel/config";
import { getDatabase } from "@/sentinel/db";
import { HttpError } from "@/sentinel/http";
import { invitationTokenSchema } from "./schema";

export const INVITATION_VALIDITY_DAYS = 30;
export const AGREEMENT_TERMS_VERSION = "orbit-msa-en-1.1";

export function hashInvitationToken(token: string) {
  return createHash("sha256").update(invitationTokenSchema.parse(token)).digest("hex");
}

export function createInvitationCredentials(now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashInvitationToken(token),
    expiresAt: new Date(now.getTime() + INVITATION_VALIDITY_DAYS * 86_400_000),
  };
}

export function invitationUrl(token: string) {
  return new URL(`/onboarding/${token}`, getServerEnv().APP_URL).toString();
}

export async function agreementFromInvitation(token: string) {
  const agreement = await getDatabase().merchantAgreement.findUnique({
    where: { invitationTokenHash: hashInvitationToken(token) },
    include: { merchant: { select: { id: true, organizationId: true, businessName: true, industry: true, country: true, legalCountry: true, businessDescription: true, expectedMonthlyVolume: true, sites: { where: { active: true }, take: 1, select: { normalizedUrl: true, hostname: true } } } } },
  });
  if (!agreement) throw new HttpError(404, "This invitation is invalid or is no longer available");
  if (agreement.status !== "SIGNED_LOCKED" && agreement.invitationExpiresAt <= new Date()) throw new HttpError(410, "This invitation has expired. Ask ORBIT for a new link.");
  return agreement;
}

export function publicAgreementState(agreement: Awaited<ReturnType<typeof agreementFromInvitation>>) {
  const isBlankSelfServeInvitation = agreement.selfServe && agreement.status === "INVITED";
  const website = isBlankSelfServeInvitation ? "" : agreement.merchant.sites[0]?.normalizedUrl ?? "";
  return {
    status: agreement.status,
    locked: agreement.status === "SIGNED_LOCKED",
    expiresAt: agreement.invitationExpiresAt,
    termsVersion: agreement.termsVersion,
    merchant: {
      businessName: isBlankSelfServeInvitation ? "" : agreement.merchant.businessName,
      industry: isBlankSelfServeInvitation ? "" : agreement.merchant.industry,
      website,
      operatingCountry: isBlankSelfServeInvitation ? "" : agreement.merchant.country,
      businessDescription: isBlankSelfServeInvitation ? "" : agreement.merchant.businessDescription,
    },
    intake: agreement.status === "INVITED" ? {
      businessName: isBlankSelfServeInvitation ? "" : agreement.merchant.businessName,
      publicWebsite: website,
      industry: isBlankSelfServeInvitation ? "" : agreement.merchant.industry,
      operatingCountry: isBlankSelfServeInvitation ? "" : agreement.merchant.country,
      businessDescription: isBlankSelfServeInvitation ? "" : agreement.merchant.businessDescription,
      legalName: agreement.legalName ?? (isBlankSelfServeInvitation ? "" : agreement.merchant.businessName),
      tradeName: agreement.tradeName ?? "",
      entityType: agreement.entityType ?? "",
      taxId: agreement.taxId ?? "",
      registrationNumber: agreement.registrationNumber ?? "",
      businessAddress: agreement.businessAddress ?? "",
      city: agreement.city ?? "",
      region: agreement.region ?? "",
      postalCode: agreement.postalCode ?? "",
      countryCode: agreement.countryCode ?? (isBlankSelfServeInvitation ? "" : agreement.merchant.legalCountry ?? ""),
      coveredDomains: agreement.coveredDomains ?? website,
      primaryContactName: agreement.primaryContactName ?? "",
      primaryContactRole: agreement.primaryContactRole ?? "",
      primaryContactEmail: agreement.primaryContactEmail ?? "",
      primaryContactPhone: agreement.primaryContactPhone ?? "",
      billingDescriptor: agreement.billingDescriptor ?? "",
      estimatedMonthlyVolume: agreement.estimatedMonthlyVolume ?? (isBlankSelfServeInvitation ? "" : agreement.merchant.expectedMonthlyVolume ?? ""),
      averageTransactionAmount: agreement.averageTransactionAmount ?? "",
      highestTransactionAmount: agreement.highestTransactionAmount ?? "",
      productsAndServices: agreement.productsAndServices ?? (isBlankSelfServeInvitation ? "" : agreement.merchant.businessDescription),
    } : undefined,
    selfServe: agreement.selfServe,
    completed: agreement.status !== "INVITED",
    contractReady: ["DATA_COMPLETED", "CONTRACT_ISSUED"].includes(agreement.status),
    signedUploadedAt: agreement.signedUploadedAt,
    signedOriginalName: agreement.signedOriginalName,
  };
}

export function agreementAdminState(agreement: {
  status: string;
  invitationExpiresAt: Date;
  invitationIssuedAt: Date | null;
  informationCertifiedAt: Date | null;
  contractIssuedAt: Date | null;
  signedUploadedAt: Date | null;
  signedOriginalName: string | null;
  signedSizeBytes: number | null;
  lockedAt: Date | null;
  termsVersion: string;
} | null) {
  if (!agreement) return null;
  const workflow = agreement.status === "SIGNED_LOCKED" ? "SIGNED" : agreement.status === "CONTRACT_ISSUED" ? "AWAITING_SIGNATURE" : agreement.status === "DATA_COMPLETED" ? "READY_TO_ISSUE" : agreement.invitationIssuedAt ? "AWAITING_CUSTOMER" : "OPTIONAL";
  return {
    status: agreement.status,
    workflow,
    invitationExpiresAt: agreement.invitationExpiresAt,
    invitationIssuedAt: agreement.invitationIssuedAt,
    informationCertifiedAt: agreement.informationCertifiedAt,
    contractIssuedAt: agreement.contractIssuedAt,
    signedUploadedAt: agreement.signedUploadedAt,
    signedOriginalName: agreement.signedOriginalName,
    signedSizeBytes: agreement.signedSizeBytes,
    lockedAt: agreement.lockedAt,
    termsVersion: agreement.termsVersion,
  };
}

export async function rotateInvitation(merchantId: string) {
  const current = await getDatabase().merchantAgreement.findUnique({ where: { merchantId }, select: { status: true } });
  if (current?.status === "SIGNED_LOCKED") throw new HttpError(409, "The signed agreement is locked and the invitation cannot be changed");
  const invitation = createInvitationCredentials();
  await getDatabase().merchantAgreement.upsert({
    where: { merchantId },
    create: { merchantId, invitationTokenHash: invitation.tokenHash, invitationExpiresAt: invitation.expiresAt, invitationIssuedAt: new Date(), termsVersion: AGREEMENT_TERMS_VERSION },
    update: { invitationTokenHash: invitation.tokenHash, invitationExpiresAt: invitation.expiresAt, invitationIssuedAt: new Date(), termsVersion: AGREEMENT_TERMS_VERSION },
  });
  return { url: invitationUrl(invitation.token), expiresAt: invitation.expiresAt };
}
