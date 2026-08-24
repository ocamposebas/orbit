import { z } from "zod";

const required = (label: string, max = 160) => z.string().trim().min(2, `${label} is required`).max(max);
const optional = (max = 160) => z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().max(max).optional(),
);

export const merchantAgreementIntakeSchema = z.object({
  businessName: required("Business name", 120),
  publicWebsite: required("Public website", 2_048),
  industry: required("Industry", 80),
  operatingCountry: required("Operating country or market", 80),
  businessDescription: required("Business description", 2_000),
  legalName: required("Legal business name", 160),
  tradeName: optional(160),
  entityType: required("Entity type", 80),
  taxId: required("Tax identifier", 80),
  registrationNumber: optional(100),
  businessAddress: required("Business address", 240),
  city: required("City", 100),
  region: required("State / region", 100),
  postalCode: required("Postal code", 30),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a two-letter country code"),
  coveredDomains: required("Covered websites and domains", 1_500),
  primaryContactName: required("Primary contact name", 140),
  primaryContactRole: required("Primary contact role", 100),
  primaryContactEmail: z.string().trim().toLowerCase().email().max(254),
  primaryContactPhone: required("Primary contact phone", 50),
  billingDescriptor: required("Billing descriptor", 40),
  estimatedMonthlyVolume: required("Estimated monthly volume", 80),
  averageTransactionAmount: required("Average transaction amount", 80),
  highestTransactionAmount: required("Highest transaction amount", 80),
  productsAndServices: required("Products and services", 2_500),
  certifyAuthority: z.literal(true, { error: "Authority confirmation is required" }),
  certifyAccuracy: z.literal(true, { error: "Accuracy confirmation is required" }),
  acceptElectronicProcess: z.literal(true, { error: "Electronic process consent is required" }),
});

export const invitationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Invalid invitation token");

export const SIGNED_CONTRACT_MAX_BYTES = 15 * 1024 * 1024;
export const SIGNED_CONTRACT_TYPES = new Set(["application/pdf"]);

export type MerchantAgreementIntake = z.infer<typeof merchantAgreementIntakeSchema>;
