import { describe, expect, it } from "vitest";
import { normalizeWooCommerceBaseUrl, validateWooCommerceBaseUrl } from "@/commerce/woocommerce/configuration";
import { decryptRelaySecret, encryptRelaySecret } from "@/commerce/woocommerce/crypto";
import { safeRelayIntegration } from "@/commerce/woocommerce/service";

const key = Buffer.alloc(32, 7).toString("base64");
const merchantId = "cm12345678901234567890123";

describe("WooCommerce Relay secret security", () => {
  it("encrypts the signing secret with authenticated AES-256-GCM", () => {
    const secret = "relay-signing-secret-value";
    const encrypted = encryptRelaySecret(secret, merchantId, key);
    expect(encrypted).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(encrypted).not.toContain(secret);
    expect(decryptRelaySecret(encrypted, merchantId, key)).toBe(secret);
    expect(() => decryptRelaySecret(encrypted, "cm99999999999999999999999", key)).toThrow(/cannot be decrypted/);
  });

  it("never exposes encrypted or plaintext secret fields in the safe API shape", () => {
    const safe = safeRelayIntegration({ id: "relay_1", merchantId, baseUrl: "https://wp.example.com", environment: "PRODUCTION", connectionEnabled: true, connectionStatus: "CONFIGURED", relayVersion: null, woocommerceAvailable: null, lastHealthCheckAt: null, lastSuccessfulRequestAt: null, lastLatencyMs: null, lastErrorCode: null, createdAt: new Date(), updatedAt: new Date(), encryptedSigningSecret: "ciphertext" } as never);
    const serialized = JSON.stringify(safe);
    expect(safe.signingConfigured).toBe(true);
    expect(serialized).not.toContain("ciphertext");
    expect(serialized).not.toContain("encryptedSigningSecret");
    expect(serialized).not.toContain("signingSecret");
  });
});

describe("WooCommerce Relay URL validation", () => {
  it("stores only the canonical origin", () => {
    expect(normalizeWooCommerceBaseUrl("https://WP.Example.com:443/", "PRODUCTION")).toBe("https://wp.example.com");
  });

  it.each([
    "https://user:password@wp.example.com",
    "https://wp.example.com/store",
    "https://wp.example.com?redirect=internal",
    "https://wp.example.com#fragment",
    "javascript:alert(1)",
    "file:///etc/passwd",
  ])("rejects invalid base URL %s", (url) => {
    expect(() => normalizeWooCommerceBaseUrl(url, "PRODUCTION")).toThrow();
  });

  it("rejects HTTP for Production but permits it syntactically for Staging", () => {
    expect(() => normalizeWooCommerceBaseUrl("http://wp.example.com", "PRODUCTION")).toThrow(/must use HTTPS/);
    expect(normalizeWooCommerceBaseUrl("http://wp.example.com", "STAGING")).toBe("http://wp.example.com");
  });

  it("blocks private and loopback destinations", async () => {
    await expect(validateWooCommerceBaseUrl("http://127.0.0.1:8080", "STAGING")).rejects.toThrow(/public, non-reserved/);
  });
});
