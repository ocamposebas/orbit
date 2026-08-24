import { createHash, randomBytes } from "node:crypto";
import { getServerEnv } from "@/sentinel/config";
import { getDatabase } from "@/sentinel/db";
import { HttpError } from "@/sentinel/http";
import { invitationTokenSchema } from "./schema";

export const INVITATION_VALIDITY_DAYS = 30;
export const AGREEMENT_TERMS_VERSION = "orbit-msa-es-1.0";

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
    include: { merchant: { select: { id: true, organizationId: true, businessName: true, industry: true, businessDescription: true, expectedMonthlyVolume: true, sites: { where: { active: true }, take: 1, select: { normalizedUrl: true, hostname: true } } } } },
  });
  if (!agreement) throw new HttpError(404, "This invitation is invalid or is no longer available");
  if (agreement.status !== "SIGNED_LOCKED" && agreement.invitationExpiresAt <= new Date()) throw new HttpError(410, "This invitation has expired. Ask ORBIT for a new link.");
  return agreement;
}

export function publicAgreementState(agreement: Awaited<ReturnType<typeof agreementFromInvitation>>) {
  return {
    status: agreement.status,
    locked: agreement.status === "SIGNED_LOCKED",
    expiresAt: agreement.invitationExpiresAt,
    termsVersion: agreement.termsVersion,
    merchant: {
      businessName: agreement.merchant.businessName,
      industry: agreement.merchant.industry,
      website: agreement.merchant.sites[0]?.normalizedUrl ?? "",
    },
    completed: agreement.status !== "INVITED",
    contractReady: ["DATA_COMPLETED", "CONTRACT_ISSUED"].includes(agreement.status),
    signedUploadedAt: agreement.signedUploadedAt,
    signedOriginalName: agreement.signedOriginalName,
  };
}

export function agreementAdminState(agreement: {
  status: string;
  invitationExpiresAt: Date;
  informationCertifiedAt: Date | null;
  contractIssuedAt: Date | null;
  signedUploadedAt: Date | null;
  signedOriginalName: string | null;
  signedSizeBytes: number | null;
  lockedAt: Date | null;
  termsVersion: string;
} | null) {
  if (!agreement) return null;
  return {
    status: agreement.status,
    invitationExpiresAt: agreement.invitationExpiresAt,
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
    create: { merchantId, invitationTokenHash: invitation.tokenHash, invitationExpiresAt: invitation.expiresAt, termsVersion: AGREEMENT_TERMS_VERSION },
    update: { invitationTokenHash: invitation.tokenHash, invitationExpiresAt: invitation.expiresAt },
  });
  return { url: invitationUrl(invitation.token), expiresAt: invitation.expiresAt };
}
