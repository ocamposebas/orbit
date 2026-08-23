import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/sentinel/http";

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(), rateLimit: vi.fn(), validateUrl: vi.fn(), find: vi.fn(), upsert: vi.fn(), audit: vi.fn(), transaction: vi.fn(), health: vi.fn(),
}));

vi.mock("@/sentinel/config", () => ({ getServerEnv: () => ({ ORBIT_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64") }) }));
vi.mock("@/sentinel/http", () => {
  class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
  return { HttpError, requireMerchantAccess: mocks.requireAccess, apiError: (error: { status?: number; message?: string }) => Response.json({ error: error.message ?? "Unexpected server error" }, { status: error.status ?? 500 }) };
});
vi.mock("@/sentinel/rate-limit", () => ({ enforceRateLimit: mocks.rateLimit }));
vi.mock("@/commerce/woocommerce/configuration", () => ({
  relayConfigurationSchema: { parse: (value: unknown) => value },
  validateWooCommerceBaseUrl: mocks.validateUrl,
}));
vi.mock("@/commerce/woocommerce/service", () => ({
  safeRelayIntegration: (value: Record<string, unknown>) => {
    const safe = { ...value };
    delete safe.encryptedSigningSecret;
    return { ...safe, signingConfigured: true };
  },
  checkWooCommerceRelayHealth: mocks.health,
}));
vi.mock("@/sentinel/db", () => ({ getDatabase: () => ({ wooCommerceRelayIntegration: { findUnique: mocks.find }, auditLog: { create: mocks.audit }, $transaction: mocks.transaction }) }));

const merchantId = "cm12345678901234567890123";
const secret = "wordpress-relay-signing-secret";
const requestBody = { baseUrl: "https://wp.rgvprimellc.com", environment: "PRODUCTION", signingSecret: secret, connectionEnabled: true };
const now = new Date("2026-08-22T20:00:00.000Z");

function access(role: "OWNER" | "ADMIN") {
  return { session: { role, user: { id: `user_${role.toLowerCase()}` }, organization: { id: "org_1" } }, organization: { id: "org_1" }, merchant: { id: merchantId, organizationId: "org_1" } };
}

function request(body: object = requestBody) {
  return new Request(`https://orbit.example/api/sentinel/merchants/${merchantId}/relay`, { method: "PUT", headers: { "content-type": "application/json", origin: "https://orbit.example" }, body: JSON.stringify(body) });
}

describe("WooCommerce Relay routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValue(undefined);
    mocks.validateUrl.mockResolvedValue("https://wp.rgvprimellc.com");
    mocks.find.mockResolvedValue(null);
    mocks.upsert.mockImplementation(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({ id: "relay_1", ...create, ...update, relayVersion: null, woocommerceAvailable: null, lastHealthCheckAt: null, lastSuccessfulRequestAt: null, lastLatencyMs: null, lastErrorCode: null, createdAt: now, updatedAt: now }));
    mocks.audit.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({ wooCommerceRelayIntegration: { upsert: mocks.upsert }, auditLog: { create: mocks.audit } }));
  });

  it.each(["OWNER", "ADMIN"] as const)("allows %s to configure Relay and encrypts the secret", async (role) => {
    mocks.requireAccess.mockResolvedValueOnce(access(role));
    const { PUT } = await import("@/app/api/sentinel/merchants/[merchantId]/relay/route");
    const response = await PUT(request() as never, { params: Promise.resolve({ merchantId }) });
    expect(response.status).toBe(200);
    expect(mocks.requireAccess).toHaveBeenCalledWith(expect.any(Request), merchantId, { allowedRoles: ["OWNER", "ADMIN"], mutation: true });
    const persisted = mocks.upsert.mock.calls[0][0].create.encryptedSigningSecret as string;
    expect(persisted).toMatch(/^v1:/);
    expect(persisted).not.toContain(secret);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(persisted);
    expect(serialized).not.toContain("encryptedSigningSecret");
  });

  it.each(["VIEWER", "REVIEWER"])("forbids %s from configuring Relay", async (role) => {
    mocks.requireAccess.mockRejectedValueOnce(new HttpError(403, `${role} forbidden`));
    const { PUT } = await import("@/app/api/sentinel/merchants/[merchantId]/relay/route");
    const response = await PUT(request() as never, { params: Promise.resolve({ merchantId }) });
    expect(response.status).toBe(403);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it.each(["wrong organization", "merchant not found"])("returns 404 for %s without writing configuration", async (reason) => {
    mocks.requireAccess.mockRejectedValueOnce(new HttpError(404, reason));
    const { PUT } = await import("@/app/api/sentinel/merchants/[merchantId]/relay/route");
    const response = await PUT(request() as never, { params: Promise.resolve({ merchantId }) });
    expect(response.status).toBe(404);
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("preserves the stored encrypted secret when an existing configuration is updated without a secret", async () => {
    mocks.requireAccess.mockResolvedValueOnce(access("OWNER"));
    mocks.find.mockResolvedValueOnce({ id: "relay_1", merchantId, encryptedSigningSecret: "v1:existing-ciphertext", connectionEnabled: true });
    const { PUT } = await import("@/app/api/sentinel/merchants/[merchantId]/relay/route");
    const response = await PUT(request({ baseUrl: requestBody.baseUrl, environment: "PRODUCTION", connectionEnabled: true }) as never, { params: Promise.resolve({ merchantId }) });
    expect(response.status).toBe(200);
    expect(mocks.upsert.mock.calls[0][0].update.encryptedSigningSecret).toBe("v1:existing-ciphertext");
  });

  it("uses an upsert and writes safe configuration and enabled audit events", async () => {
    mocks.requireAccess.mockResolvedValueOnce(access("ADMIN"));
    const { PUT } = await import("@/app/api/sentinel/merchants/[merchantId]/relay/route");
    await PUT(request() as never, { params: Promise.resolve({ merchantId }) });
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledTimes(2);
    expect(mocks.audit.mock.calls.map((call) => call[0].data.action)).toEqual(["WOO_RELAY_CONFIGURED", "WOO_RELAY_ENABLED"]);
    const auditJson = JSON.stringify(mocks.audit.mock.calls);
    expect(auditJson).not.toContain(secret);
    expect(auditJson).not.toContain("encryptedSigningSecret");
  });

  it("audits a successful health check without exposing secrets", async () => {
    mocks.requireAccess.mockResolvedValueOnce(access("OWNER"));
    mocks.health.mockResolvedValueOnce({ id: "relay_1", merchantId, baseUrl: requestBody.baseUrl, environment: "PRODUCTION", ok: true, message: "Connected", connectionStatus: "CONNECTED", lastLatencyMs: 84, lastErrorCode: null, signingConfigured: true });
    const { POST } = await import("@/app/api/sentinel/merchants/[merchantId]/relay/test/route");
    const response = await POST(new Request(`https://orbit.example/api/sentinel/merchants/${merchantId}/relay/test`, { method: "POST" }) as never, { params: Promise.resolve({ merchantId }) });
    expect(response.status).toBe(200);
    expect(mocks.health).toHaveBeenCalledWith(merchantId);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "WOO_RELAY_HEALTH_CHECK", metadata: { merchantId, baseUrl: requestBody.baseUrl, environment: "PRODUCTION", latency: 84, errorCode: null } }) }));
  });

  it("audits a normalized failed health check", async () => {
    mocks.requireAccess.mockResolvedValueOnce(access("ADMIN"));
    mocks.health.mockResolvedValueOnce({ id: "relay_1", merchantId, baseUrl: requestBody.baseUrl, environment: "PRODUCTION", ok: false, message: "Unreachable", connectionStatus: "UNREACHABLE", lastLatencyMs: 6_000, lastErrorCode: "CONNECTION_TIMEOUT", signingConfigured: true });
    const { POST } = await import("@/app/api/sentinel/merchants/[merchantId]/relay/test/route");
    const response = await POST(new Request(`https://orbit.example/api/sentinel/merchants/${merchantId}/relay/test`, { method: "POST" }) as never, { params: Promise.resolve({ merchantId }) });
    expect(response.status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "WOO_RELAY_HEALTH_FAILED", metadata: expect.objectContaining({ errorCode: "CONNECTION_TIMEOUT" }) }) }));
  });
});
