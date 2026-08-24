import { z } from "zod";
import { getDatabase } from "@/sentinel/db";
import { normalizePublicUrl } from "@/sentinel/security/ssrf";
import { isStripeConnectCountry } from "@/stripe/countries";
import { AGREEMENT_TERMS_VERSION, createInvitationCredentials } from "@/contracts/service";

export const legalCountrySchema = z.string()
  .regex(/^[A-Z]{2}$/, "Use an uppercase ISO 3166-1 alpha-2 country code")
  .refine(isStripeConnectCountry, "Country is not supported for Stripe Connect");

const optionalLegalCountrySchema = z.preprocess(
  (value) => value === "" ? undefined : value,
  legalCountrySchema.optional(),
);

export const createMerchantSchema = z.object({ organizationId: z.string().min(1), businessName: z.string().trim().min(2).max(120), industry: z.string().trim().min(2).max(80), country: z.string().trim().min(2).max(80), legalCountry: optionalLegalCountrySchema, businessDescription: z.string().trim().min(10).max(2_000), website: z.string().trim().min(1), expectedMonthlyVolume: z.string().trim().max(80).optional() });
export const updateMerchantLegalCountrySchema = z.object({ legalCountry: legalCountrySchema.nullable() });

function slugify(value: string) { return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60); }

export async function createMerchant(input: z.infer<typeof createMerchantSchema>) {
  const data = createMerchantSchema.parse(input);
  const target = normalizePublicUrl(data.website);
  const db = getDatabase();
  const invitation = createInvitationCredentials();
  const baseSlug = slugify(data.businessName) || "merchant";
  let slug = baseSlug; let suffix = 1;
  while (await db.merchant.findUnique({ where: { organizationId_slug: { organizationId: data.organizationId, slug } }, select: { id: true } })) slug = `${baseSlug}-${++suffix}`;
  return db.$transaction(async (tx) => {
    const merchant = await tx.merchant.create({ data: { organizationId: data.organizationId, businessName: data.businessName, slug, industry: data.industry, country: data.country, legalCountry: data.legalCountry, businessDescription: data.businessDescription, expectedMonthlyVolume: data.expectedMonthlyVolume } });
    await tx.merchantSite.create({ data: { merchantId: merchant.id, url: target.toString(), normalizedUrl: target.toString(), hostname: target.hostname } });
    await tx.merchantAgreement.create({ data: { merchantId: merchant.id, invitationTokenHash: invitation.tokenHash, invitationExpiresAt: invitation.expiresAt, termsVersion: AGREEMENT_TERMS_VERSION } });
    await tx.auditLog.create({ data: { organizationId: data.organizationId, merchantId: merchant.id, action: "merchant.created", targetType: "Merchant", targetId: merchant.id, metadata: { website: target.toString() } } });
    return { merchant, invitationToken: invitation.token, invitationExpiresAt: invitation.expiresAt };
  });
}
