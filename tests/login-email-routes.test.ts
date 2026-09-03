import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMAIL_LOGIN_CHALLENGE_COOKIE, TWO_FACTOR_CHALLENGE_COOKIE } from "@/sentinel/auth/constants";
import { loginEmailCodeHash } from "@/sentinel/auth/login-email";

const mocks = vi.hoisted(() => ({
  cookieValues: new Map<string, string>(),
  cookieSet: vi.fn(),
  verifyPassword: vi.fn(),
  rateLimit: vi.fn(),
  sendEmail: vi.fn(),
  createSession: vi.fn(),
  userFind: vi.fn(),
  userUpdate: vi.fn(),
  emailDeleteMany: vi.fn(),
  emailCreate: vi.fn(),
  emailUpsert: vi.fn(),
  emailFind: vi.fn(),
  emailUpdate: vi.fn(),
  emailUpdateMany: vi.fn(),
  emailDelete: vi.fn(),
  twoFactorDeleteMany: vi.fn(),
  twoFactorCreate: vi.fn(),
  twoFactorFind: vi.fn(),
  twoFactorDelete: vi.fn(),
  twoFactorUpdate: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => mocks.cookieValues.has(name) ? { value: mocks.cookieValues.get(name) } : undefined,
    set: (name: string, value: string, options: unknown) => { mocks.cookieValues.set(name, value); mocks.cookieSet(name, value, options); },
  }),
}));
vi.mock("@/sentinel/auth/password", () => ({ verifyPassword: mocks.verifyPassword }));
vi.mock("@/sentinel/rate-limit", () => ({ enforceRateLimit: mocks.rateLimit }));
vi.mock("@/sentinel/auth/session", () => ({
  createSession: mocks.createSession,
  SESSION_COOKIE: "orbit_session",
  sessionCookieOptions: { httpOnly: true, sameSite: "lax", secure: false, path: "/", priority: "high" },
}));
vi.mock("@/sentinel/http", () => ({
  HttpError: class extends Error { constructor(readonly status: number, message: string) { super(message); } },
  validateMutationOrigin: vi.fn(),
  apiError: (error: { status?: number; message?: string }) => Response.json({ error: error.message ?? "Unexpected server error" }, { status: error.status ?? 500 }),
}));
vi.mock("@/sentinel/auth/login-email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/sentinel/auth/login-email")>()),
  sendLoginVerificationEmail: mocks.sendEmail,
}));
vi.mock("@/sentinel/db", () => {
  const database = {
    user: { findUnique: mocks.userFind, update: mocks.userUpdate },
    emailLoginChallenge: { deleteMany: mocks.emailDeleteMany, create: mocks.emailCreate, upsert: mocks.emailUpsert, findUnique: mocks.emailFind, update: mocks.emailUpdate, updateMany: mocks.emailUpdateMany, delete: mocks.emailDelete },
    twoFactorChallenge: { deleteMany: mocks.twoFactorDeleteMany, create: mocks.twoFactorCreate, findUnique: mocks.twoFactorFind, delete: mocks.twoFactorDelete, update: mocks.twoFactorUpdate },
    auditLog: { create: mocks.auditCreate },
    $transaction: async (operation: unknown) => typeof operation === "function" ? (operation as (database: unknown) => unknown)(database) : Promise.all(operation as Promise<unknown>[]),
  };
  return { getDatabase: () => database };
});

const user = {
  id: "user_1",
  email: "correct.person@example.com",
  name: "Correct Person",
  active: true,
  passwordHash: "hash",
  twoFactorEnabledAt: null,
  twoFactorSecretEncrypted: null,
  memberships: [{ organizationId: "org_1", role: "VIEWER", organization: { id: "org_1", name: "ORBIT" } }],
};

function request(path: string, body?: unknown) {
  return new Request(`https://orbit.example${path}`, { method: "POST", headers: { origin: "https://orbit.example", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}

describe("mandatory login email verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookieValues.clear();
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.rateLimit.mockResolvedValue(undefined);
    mocks.userFind.mockResolvedValue(user);
    mocks.emailDeleteMany.mockResolvedValue({ count: 0 });
    mocks.emailCreate.mockResolvedValue({ id: "email_challenge_1" });
    mocks.emailUpsert.mockResolvedValue({ id: "email_challenge_1" });
    mocks.emailUpdate.mockResolvedValue({});
    mocks.emailUpdateMany.mockResolvedValue({ count: 1 });
    mocks.emailDelete.mockResolvedValue({});
    mocks.twoFactorDeleteMany.mockResolvedValue({ count: 0 });
    mocks.twoFactorCreate.mockResolvedValue({});
    mocks.twoFactorDelete.mockResolvedValue({});
    mocks.twoFactorUpdate.mockResolvedValue({});
    mocks.userUpdate.mockResolvedValue({});
    mocks.auditCreate.mockResolvedValue({});
    mocks.sendEmail.mockResolvedValue({ messageId: "smtp-message-1" });
    mocks.createSession.mockResolvedValue({ token: "session-token", expiresAt: new Date("2026-09-10T00:00:00.000Z") });
  });

  it("sends to the database email and does not create a session after password verification", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    const response = await POST(request("/api/auth/login", { email: user.email, password: "correct-password" }) as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ emailVerificationRequired: true, emailHint: "co••••••••@example.com" });
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ recipient: user.email, name: user.name, code: expect.stringMatching(/^\d{6}$/) }));
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.cookieSet).toHaveBeenCalledWith(EMAIL_LOGIN_CHALLENGE_COOKIE, expect.any(String), expect.objectContaining({ httpOnly: true }));
    expect(mocks.emailUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deliveryStatus: "SENT", messageId: "smtp-message-1" }) }));
  });

  it("fails closed when SMTP does not accept the login email", async () => {
    mocks.sendEmail.mockRejectedValueOnce(Object.assign(new Error("mailbox unavailable"), { code: "EENVELOPE" }));
    const { POST } = await import("@/app/api/auth/login/route");
    const response = await POST(request("/api/auth/login", { email: user.email, password: "correct-password" }) as never);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "We could not send the sign-in code. Please try again." });
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalledWith(EMAIL_LOGIN_CHALLENGE_COOKIE, expect.any(String), expect.anything());
    expect(mocks.emailUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ deliveryStatus: "FAILED", lastDeliveryErrorCode: "EENVELOPE" }) }));
  });

  it("creates a session only after the emailed one-time code is consumed", async () => {
    const token = "opaque-email-cookie";
    const code = "042731";
    mocks.cookieValues.set(EMAIL_LOGIN_CHALLENGE_COOKIE, token);
    mocks.emailFind.mockResolvedValue({
      id: "email_challenge_1", tokenHash: "token-hash", codeHash: loginEmailCodeHash(token, code), userId: user.id, organizationId: "org_1",
      expiresAt: new Date(Date.now() + 60_000), attempts: 0, deliveryStatus: "SENT", user, organization: { id: "org_1", name: "ORBIT" },
    });
    const { POST } = await import("@/app/api/auth/email-code/login/route");
    const response = await POST(request("/api/auth/email-code/login", { code }) as never);
    expect(response.status).toBe(200);
    expect(mocks.emailDelete).toHaveBeenCalledWith({ where: { id: "email_challenge_1" } });
    expect(mocks.createSession).toHaveBeenCalledWith(user.id, "org_1", expect.any(Object));
    expect(mocks.cookieSet).toHaveBeenCalledWith("orbit_session", "session-token", expect.objectContaining({ httpOnly: true }));
  });

  it("counts an incorrect code without creating a session", async () => {
    const token = "opaque-email-cookie";
    mocks.cookieValues.set(EMAIL_LOGIN_CHALLENGE_COOKIE, token);
    mocks.emailFind.mockResolvedValue({
      id: "email_challenge_1", codeHash: loginEmailCodeHash(token, "111111"), userId: user.id, organizationId: "org_1",
      expiresAt: new Date(Date.now() + 60_000), attempts: 0, deliveryStatus: "SENT", user, organization: { id: "org_1", name: "ORBIT" },
    });
    const { POST } = await import("@/app/api/auth/email-code/login/route");
    const response = await POST(request("/api/auth/email-code/login", { code: "222222" }) as never);
    expect(response.status).toBe(401);
    expect(mocks.emailUpdate).toHaveBeenCalledWith({ where: { id: "email_challenge_1" }, data: { attempts: { increment: 1 } } });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("requires the authenticator only after email verification when it is enabled", async () => {
    const token = "opaque-email-cookie";
    const code = "314159";
    mocks.cookieValues.set(EMAIL_LOGIN_CHALLENGE_COOKIE, token);
    mocks.emailFind.mockResolvedValue({
      id: "email_challenge_1", codeHash: loginEmailCodeHash(token, code), userId: user.id, organizationId: "org_1",
      expiresAt: new Date(Date.now() + 60_000), attempts: 0, deliveryStatus: "SENT",
      user: { ...user, twoFactorEnabledAt: new Date(), twoFactorSecretEncrypted: "encrypted" }, organization: { id: "org_1", name: "ORBIT" },
    });
    const { POST } = await import("@/app/api/auth/email-code/login/route");
    const response = await POST(request("/api/auth/email-code/login", { code }) as never);
    expect(await response.json()).toEqual({ twoFactorRequired: true });
    expect(mocks.twoFactorCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: user.id, emailVerifiedAt: expect.any(Date) }) });
    expect(mocks.cookieSet).toHaveBeenCalledWith(TWO_FACTOR_CHALLENGE_COOKIE, expect.any(String), expect.objectContaining({ httpOnly: true }));
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("resends only to the email stored on the user record", async () => {
    const token = "opaque-email-cookie";
    mocks.cookieValues.set(EMAIL_LOGIN_CHALLENGE_COOKIE, token);
    mocks.emailFind.mockResolvedValue({ id: "email_challenge_1", userId: user.id, organizationId: "org_1", expiresAt: new Date(Date.now() + 60_000), sendCount: 1, user });
    const { POST } = await import("@/app/api/auth/email-code/resend/route");
    const response = await POST(request("/api/auth/email-code/resend") as never);
    expect(response.status).toBe(200);
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ recipient: user.email, code: expect.stringMatching(/^\d{6}$/) }));
    expect(mocks.emailUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ deliveryStatus: "SENT", messageId: "smtp-message-1" }) }));
  });

  it("refuses to resend more than three messages for one password challenge", async () => {
    mocks.cookieValues.set(EMAIL_LOGIN_CHALLENGE_COOKIE, "opaque-email-cookie");
    mocks.emailFind.mockResolvedValue({ id: "email_challenge_1", userId: user.id, organizationId: "org_1", expiresAt: new Date(Date.now() + 60_000), sendCount: 3, user });
    const { POST } = await import("@/app/api/auth/email-code/resend/route");
    const response = await POST(request("/api/auth/email-code/resend") as never);
    expect(response.status).toBe(429);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("does not accept an authenticator challenge that was not preceded by email verification", async () => {
    mocks.cookieValues.set(TWO_FACTOR_CHALLENGE_COOKIE, "opaque-two-factor-cookie");
    mocks.twoFactorFind.mockResolvedValue({
      id: "two_factor_1", userId: user.id, organizationId: "org_1", expiresAt: new Date(Date.now() + 60_000), attempts: 0, emailVerifiedAt: null,
      user: { ...user, twoFactorSecretEncrypted: "encrypted" }, organization: { id: "org_1", name: "ORBIT" },
    });
    const { POST } = await import("@/app/api/auth/2fa/login/route");
    const response = await POST(request("/api/auth/2fa/login", { code: "123456" }) as never);
    expect(response.status).toBe(401);
    expect(mocks.twoFactorDelete).toHaveBeenCalledWith({ where: { id: "two_factor_1" } });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
