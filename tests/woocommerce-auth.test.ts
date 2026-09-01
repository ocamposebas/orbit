import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWooCommerceAuthHeaders, signWooCommerceRequest, signaturesMatch } from "@/commerce/woocommerce/auth";

const mocks = vi.hoisted(() => ({ installationFind: vi.fn(), installationUpdate: vi.fn(), nonceCreate: vi.fn(), nonceDelete: vi.fn() }));
vi.mock("@/sentinel/db", () => ({ getDatabase: () => ({
  wooCommerceInstallation: { findFirst: mocks.installationFind, update: mocks.installationUpdate },
  wooCommerceRequestNonce: { create: mocks.nonceCreate, deleteMany: mocks.nonceDelete },
}) }));
vi.mock("@/commerce/woocommerce/installation-crypto", () => ({ decryptInstallationSecret: () => "installation-secret" }));

const installation = {
  id: "ins_installation1234567890",
  merchantId: "merchant_1",
  publicMerchantId: "mrc_merchant1234567890",
  merchant: { publicId: "mrc_merchant1234567890" },
  origin: "https://shop.example",
  environment: "LIVE",
  encryptedSigningSecret: "encrypted",
  enabled: true,
  hostedPaymentsEnabled: true,
  revokedAt: null,
};

function signedRequest(nonce = "nonce_1234567890abcdef", timestamp = Math.floor(Date.now() / 1_000), signatureOverride?: string) {
  const path = "/v1/woocommerce/installations/heartbeat";
  const rawBody = JSON.stringify({ site_url: "https://shop.example/", plugin_version: "1.0.1", wordpress_version: "6.8.2", woocommerce_version: "10.4.0" });
  const headers = createWooCommerceAuthHeaders({ merchantId: installation.publicMerchantId, installationId: installation.id, method: "POST", path, rawBody, secret: "installation-secret", nonce, timestamp });
  if (signatureOverride) headers["X-Orbit-Signature"] = signatureOverride;
  return { rawBody, request: new NextRequest(`https://orbit.example${path}`, { method: "POST", body: rawBody, headers }) };
}

describe("WooCommerce installation HMAC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.installationFind.mockResolvedValue(installation);
    mocks.nonceCreate.mockResolvedValue({});
    mocks.nonceDelete.mockResolvedValue({ count: 0 });
    mocks.installationUpdate.mockResolvedValue({});
  });

  it("signs the complete installation-scoped canonical request", () => {
    const signature = signWooCommerceRequest({ merchantId: "mrc", installationId: "orb_ins", timestamp: 1_788_256_800, nonce: "nonce_1234567890", method: "post", path: "/v1/test", rawBody: "{}", secret: "secret" });
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
    expect(signaturesMatch(signature, signature)).toBe(true);
    expect(signWooCommerceRequest({ merchantId: "mrc", installationId: "different", timestamp: 1_788_256_800, nonce: "nonce_1234567890", method: "post", path: "/v1/test", rawBody: "{}", secret: "secret" })).not.toBe(signature);
  });

  it("matches the PHP hash/hash_hmac v1 compatibility fixture", () => {
    const fixture = JSON.parse(readFileSync(new URL("./fixtures/woocommerce-hmac-v1.json", import.meta.url), "utf8")) as {
      merchant_id: string; installation_id: string; timestamp: number; nonce: string; method: string; path: string; raw_body: string; secret: string; signature: string;
    };
    expect(signWooCommerceRequest({ merchantId: fixture.merchant_id, installationId: fixture.installation_id, timestamp: fixture.timestamp, nonce: fixture.nonce, method: fixture.method, path: fixture.path, rawBody: fixture.raw_body, secret: fixture.secret })).toBe(fixture.signature);
  });

  it("hashes an empty raw body for signed GET requests", () => {
    const input = { merchantId: "mrc_fixture123456", installationId: "ins_fixture123456", timestamp: 1_788_282_000, nonce: "nonce_fixture_123456", method: "GET", path: "/wp-json/orbit-payments/v1/orders/5829", secret: "fixture-installation-secret" };
    expect(signWooCommerceRequest(input)).toBe(signWooCommerceRequest({ ...input, rawBody: "" }));
  });

  it("rejects an invalid signature before reserving the nonce", async () => {
    const { authenticateWooCommerceRequest } = await import("@/commerce/woocommerce/request-auth");
    const { request, rawBody } = signedRequest(undefined, undefined, "0".repeat(64));
    await expect(authenticateWooCommerceRequest(request, rawBody)).rejects.toMatchObject({ status: 401 });
    expect(mocks.nonceCreate).not.toHaveBeenCalled();
  });

  it("authenticates the public merchant identity and records activity", async () => {
    const { authenticateWooCommerceRequest } = await import("@/commerce/woocommerce/request-auth");
    const { request, rawBody } = signedRequest();
    await expect(authenticateWooCommerceRequest(request, rawBody)).resolves.toMatchObject({ id: installation.id, publicMerchantId: installation.publicMerchantId });
    expect(mocks.installationFind).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: installation.id, merchant: { publicId: installation.publicMerchantId } }) }));
    expect(mocks.installationFind.mock.calls[0][0].where).not.toHaveProperty("lastSeenAt");
    expect(mocks.installationUpdate).toHaveBeenCalledWith({ where: { id: installation.id }, data: { lastSeenAt: expect.any(Date) } });
  });

  it("rejects a replayed nonce", async () => {
    mocks.nonceCreate.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
    const { authenticateWooCommerceRequest } = await import("@/commerce/woocommerce/request-auth");
    const { request, rawBody } = signedRequest();
    await expect(authenticateWooCommerceRequest(request, rawBody)).rejects.toMatchObject({ status: 409, message: "WooCommerce request replay rejected" });
  });

  it("rejects expired timestamps and revoked installations", async () => {
    const { authenticateWooCommerceRequest } = await import("@/commerce/woocommerce/request-auth");
    const stale = signedRequest("nonce_1234567890stale", Math.floor(Date.now() / 1_000) - 301);
    await expect(authenticateWooCommerceRequest(stale.request, stale.rawBody)).rejects.toMatchObject({ status: 401 });
    mocks.installationFind.mockResolvedValueOnce(null);
    const revoked = signedRequest("nonce_1234567890revoked");
    await expect(authenticateWooCommerceRequest(revoked.request, revoked.rawBody)).rejects.toMatchObject({ status: 401 });
  });
});
