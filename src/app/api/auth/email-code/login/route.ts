import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { EMAIL_LOGIN_CHALLENGE_COOKIE, TWO_FACTOR_CHALLENGE_COOKIE } from "@/sentinel/auth/constants";
import { EMAIL_LOGIN_MAX_ATTEMPTS, verifyLoginEmailCode } from "@/sentinel/auth/login-email";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/sentinel/auth/session";
import { twoFactorTokenHash } from "@/sentinel/auth/two-factor";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, validateMutationOrigin } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export async function POST(request: NextRequest) {
  try {
    validateMutationOrigin(request);
    await enforceRateLimit(request, "auth-email-code-login", 10);
    const { code } = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).strict().parse(await request.json());
    const store = await cookies();
    const token = store.get(EMAIL_LOGIN_CHALLENGE_COOKIE)?.value;
    if (!token) throw new HttpError(401, "Your email verification expired. Sign in again.");
    const db = getDatabase();
    const challenge = await db.emailLoginChallenge.findUnique({
      where: { tokenHash: twoFactorTokenHash(token) },
      include: {
        user: { select: { id: true, email: true, name: true, active: true, twoFactorEnabledAt: true, twoFactorSecretEncrypted: true, memberships: { select: { organizationId: true, role: true } } } },
        organization: { select: { id: true, name: true } },
      },
    });
    if (!challenge || challenge.expiresAt <= new Date() || challenge.attempts >= EMAIL_LOGIN_MAX_ATTEMPTS || challenge.deliveryStatus !== "SENT" || !challenge.user.active) {
      if (challenge) await db.emailLoginChallenge.delete({ where: { id: challenge.id } }).catch(() => undefined);
      store.set(EMAIL_LOGIN_CHALLENGE_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
      throw new HttpError(401, "Your email verification expired. Sign in again.");
    }
    await enforceRateLimit(request, "auth-email-code-user", EMAIL_LOGIN_MAX_ATTEMPTS, challenge.userId);
    if (!verifyLoginEmailCode(token, code, challenge.codeHash)) {
      if (challenge.attempts + 1 >= EMAIL_LOGIN_MAX_ATTEMPTS) {
        await db.emailLoginChallenge.delete({ where: { id: challenge.id } });
        store.set(EMAIL_LOGIN_CHALLENGE_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
        throw new HttpError(401, "Too many incorrect codes. Sign in again.");
      }
      await db.emailLoginChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      throw new HttpError(401, "Email verification code is incorrect");
    }
    const membership = challenge.user.memberships.find((item) => item.organizationId === challenge.organizationId);
    if (!membership) throw new HttpError(403, "Workspace access is no longer available");
    const verifiedAt = new Date();
    if (challenge.user.twoFactorEnabledAt && challenge.user.twoFactorSecretEncrypted) {
      const twoFactorToken = randomBytes(32).toString("base64url");
      const twoFactorExpiresAt = new Date(Date.now() + 5 * 60_000);
      await db.$transaction([
        db.emailLoginChallenge.delete({ where: { id: challenge.id } }),
        db.twoFactorChallenge.deleteMany({ where: { userId: challenge.user.id } }),
        db.twoFactorChallenge.create({ data: { tokenHash: twoFactorTokenHash(twoFactorToken), userId: challenge.user.id, organizationId: challenge.organizationId, expiresAt: twoFactorExpiresAt, emailVerifiedAt: verifiedAt } }),
        db.auditLog.create({ data: { organizationId: challenge.organizationId, actorId: challenge.user.id, action: "user.login_email_code_verified", targetType: "User", targetId: challenge.user.id } }),
      ]);
      store.set(EMAIL_LOGIN_CHALLENGE_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
      store.set(TWO_FACTOR_CHALLENGE_COOKIE, twoFactorToken, { ...sessionCookieOptions, expires: twoFactorExpiresAt });
      return NextResponse.json({ twoFactorRequired: true }, { headers: { "Cache-Control": "no-store, private" } });
    }
    await db.emailLoginChallenge.delete({ where: { id: challenge.id } });
    const session = await createSession(challenge.user.id, challenge.organizationId, { ip: request.headers.get("x-forwarded-for")?.split(",")[0], userAgent: request.headers.get("user-agent") ?? undefined });
    await db.$transaction([
      db.user.update({ where: { id: challenge.user.id }, data: { lastLoginAt: verifiedAt } }),
      db.auditLog.create({ data: { organizationId: challenge.organizationId, actorId: challenge.user.id, action: "user.signed_in_email_verified", targetType: "User", targetId: challenge.user.id } }),
    ]);
    store.set(EMAIL_LOGIN_CHALLENGE_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
    store.set(SESSION_COOKIE, session.token, { ...sessionCookieOptions, expires: session.expiresAt });
    return NextResponse.json({ user: { id: challenge.user.id, email: challenge.user.email, name: challenge.user.name }, organization: challenge.organization, role: membership.role }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) { return apiError(error); }
}
