import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  codeCreate: vi.fn(), codeFind: vi.fn(), codeClaim: vi.fn(), codeUpdate: vi.fn(),
  merchantFind: vi.fn(), merchantUpdate: vi.fn(), installationFind: vi.fn(), installationCreate: vi.fn(), installationUpdate: vi.fn(), nonceDelete: vi.fn(), transaction: vi.fn(), encrypt: vi.fn(),
}));
const tx = {
  wooCommerceConnectionCode: { updateMany: mocks.codeClaim, update: mocks.codeUpdate },
  wooCommerceInstallation: { findUnique: mocks.installationFind, create: mocks.installationCreate, update: mocks.installationUpdate },
  wooCommerceRequestNonce: { deleteMany: mocks.nonceDelete },
};
vi.mock("@/sentinel/db", () => ({ getDatabase: () => ({ merchant: { findUnique: mocks.merchantFind, update: mocks.merchantUpdate }, wooCommerceConnectionCode: { create: mocks.codeCreate, findUnique: mocks.codeFind }, $transaction: mocks.transaction }) }));
vi.mock("@/commerce/woocommerce/configuration", () => ({ validateWooCommerceBaseUrl: (value: string) => Promise.resolve(new URL(value).origin) }));
vi.mock("@/commerce/woocommerce/installation-crypto", () => ({ encryptInstallationSecret: mocks.encrypt }));

describe("WooCommerce connection codes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (value: typeof tx) => unknown) => callback(tx));
    mocks.codeCreate.mockResolvedValue({});
    mocks.codeClaim.mockResolvedValue({ count: 1 });
    mocks.codeUpdate.mockResolvedValue({});
    mocks.installationFind.mockResolvedValue(null);
    mocks.merchantFind.mockResolvedValue({ publicId: "mrc_merchant123456" });
    mocks.encrypt.mockReturnValue("encrypted-secret");
  });

  it("stores only a hash and returns a short-lived one-time code", async () => {
    const { createWooCommerceConnectionCode } = await import("@/commerce/woocommerce/installations");
    const before = Date.now();
    const result = await createWooCommerceConnectionCode({ merchantId: "merchant_1", createdById: "user_1", environment: "LIVE" });
    expect(result.code).toMatch(/^orb_live_[A-Za-z0-9_-]{32}$/);
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 9 * 60_000);
    const stored = mocks.codeCreate.mock.calls[0][0].data;
    expect(stored.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(result.code);
  });

  it("rejects expired or already-consumed codes", async () => {
    const { exchangeWooCommerceConnectionCode } = await import("@/commerce/woocommerce/installations");
    mocks.codeFind.mockResolvedValueOnce({ id: "code", merchantId: "merchant_1", environment: "LIVE", expiresAt: new Date(Date.now() - 1), consumedAt: null });
    await expect(exchangeWooCommerceConnectionCode({ code: "orb_live_abcdefghijklmnopqrstuvwx", origin: "https://shop.example" })).rejects.toMatchObject({ status: 401 });
    mocks.codeFind.mockResolvedValueOnce({ id: "code", merchantId: "merchant_1", environment: "LIVE", expiresAt: new Date(Date.now() + 60_000), consumedAt: new Date() });
    await expect(exchangeWooCommerceConnectionCode({ code: "orb_live_abcdefghijklmnopqrstuvwx", origin: "https://shop.example" })).rejects.toMatchObject({ status: 401 });
  });

  it("atomically consumes a valid code and returns the secret only at exchange", async () => {
    const stored = { id: "code", merchantId: "merchant_1", environment: "LIVE" as const, expiresAt: new Date(Date.now() + 60_000), consumedAt: null };
    mocks.codeFind.mockResolvedValue(stored);
    mocks.installationCreate.mockImplementation(async ({ data }) => ({ ...data, createdAt: new Date(), updatedAt: new Date(), revokedAt: null }));
    const { exchangeWooCommerceConnectionCode } = await import("@/commerce/woocommerce/installations");
    const result = await exchangeWooCommerceConnectionCode({ code: "orb_live_abcdefghijklmnopqrstuvwx", origin: "https://shop.example", pluginVersion: "1.0.0" });
    expect(result).toMatchObject({ merchant_id: "mrc_merchant123456", environment: "live" });
    expect(result).not.toHaveProperty("status");
    expect(result.installation_id).toMatch(/^ins_/);
    expect(result.installation_secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.codeClaim).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ consumedAt: null }) }));
    expect(mocks.encrypt).toHaveBeenCalledWith(result.installation_secret, result.installation_id);
    expect(mocks.installationCreate.mock.calls[0][0].data.encryptedSigningSecret).toBe("encrypted-secret");
  });
});
