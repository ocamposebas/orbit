import { z } from "zod";

const orderTotalSchema = z.union([
  z.number().finite().positive(),
  z.string().trim().regex(/^\d+(?:\.\d+)?$/),
]);

export const ecwidPaymentPayloadSchema = z.object({
  storeId: z.union([z.number().int().positive(), z.string().trim().regex(/^\d+$/)]).transform(String),
  returnUrl: z.string().trim().min(1).max(8_192),
  token: z.string().min(1).max(512),
  cart: z.object({
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
    order: z.object({
      id: z.string().trim().min(1).max(160),
      referenceTransactionId: z.string().trim().min(1).max(240),
      total: orderTotalSchema,
      email: z.string().trim().toLowerCase().email().max(320).optional().or(z.literal("")),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

export type EcwidPaymentPayload = z.infer<typeof ecwidPaymentPayloadSchema>;
export type EcwidTargetStatus = "PAID" | "INCOMPLETE";
