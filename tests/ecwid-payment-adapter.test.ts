import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptEcwidPaymentRequest } from "@/integrations/ecwid/decrypt";
import { ecwidTotalToMinorUnits } from "@/integrations/ecwid/money";
import { stripeCheckoutSessionIdempotencyKey } from "@/integrations/ecwid/stripe-checkout";

const secret = "1234567890abcdef-private-ecwid-secret";
const payload = {
  storeId: 12345678,
  returnUrl: "https://app.ecwid.com/custompaymentapps/returnUrl?clientId=example-client&orderId=1",
  token: "configured-token",
  cart: {
    currency: "USD",
    order: { id: "1001", referenceTransactionId: "ref-very-random-1001", total: 228, email: "buyer@example.com" },
  },
};

function encrypt(value: unknown) {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-128-gcm", Buffer.from(secret.slice(0, 16), "utf8"), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString("base64url");
}

describe("Ecwid payment request adapter", () => {
  it("authenticates and validates an AES-128-GCM request", () => {
    expect(decryptEcwidPaymentRequest(encrypt(payload), secret)).toEqual({
      ...payload,
      storeId: "12345678",
      cart: { ...payload.cart, currency: "USD", order: { ...payload.cart.order, email: "buyer@example.com" } },
    });
  });

  it("rejects a modified authenticated request", () => {
    const encrypted = Buffer.from(encrypt(payload), "base64url");
    encrypted[20] ^= 1;
    expect(() => decryptEcwidPaymentRequest(encrypted.toString("base64url"), secret)).toThrow("Invalid Ecwid payment request");
  });

  it.each([
    ["228.00", "USD", 22_800],
    [0.01, "USD", 1],
    ["1e2", "USD", 10_000],
    ["250", "JPY", 250],
    ["1.234", "KWD", 1_234],
  ])("converts %s %s without floating-point rounding", (total, currency, expected) => {
    expect(ecwidTotalToMinorUnits(total, currency)).toBe(expected);
  });

  it("rejects fractions the currency cannot represent", () => {
    expect(() => ecwidTotalToMinorUnits("1.001", "USD")).toThrow("too many decimal places");
  });

  it("uses one stable Stripe Checkout idempotency key per ORBIT payment session", () => {
    const sessionId = `orb_ps_${"a".repeat(32)}`;
    expect(stripeCheckoutSessionIdempotencyKey(sessionId)).toBe(`orbit-ecwid-checkout-${sessionId}`);
    expect(stripeCheckoutSessionIdempotencyKey(sessionId)).toBe(stripeCheckoutSessionIdempotencyKey(sessionId));
  });
});
