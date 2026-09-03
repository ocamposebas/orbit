import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { TWO_FACTOR_CHALLENGE_COOKIE } from "@/sentinel/auth/constants";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/sentinel/auth/session";
import { decryptTwoFactorSecret, twoFactorTokenHash, verifyTwoFactorCode } from "@/sentinel/auth/two-factor";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, validateMutationOrigin } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export async function POST(request: NextRequest) {
  try {
    validateMutationOrigin(request);
    await enforceRateLimit(request, "auth-2fa-login", 10);
    const { code } = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).strict().parse(await request.json());
    const store = await cookies();
    const token = store.get(TWO_FACTOR_CHALLENGE_COOKIE)?.value;
    if (!token) throw new HttpError(401, "Your two-factor challenge expired. Sign in again.");
    const db = getDatabase();
    const challenge = await db.twoFactorChallenge.findUnique({
      where: { tokenHash: twoFactorTokenHash(token) },
      include: { user: { select: { id: true, email: true, name: true, active: true, twoFactorSecretEncrypted: true, memberships: { select: { organizationId: true, role: true } } } }, organization: { select: { id: true, name: true } } },
    });
    if (!challenge || challenge.expiresAt <= new Date() || challenge.attempts >= 5 || !challenge.emailVerifiedAt || !challenge.user.active || !challenge.user.twoFactorSecretEncrypted) {
      if (challenge) await db.twoFactorChallenge.delete({ where: { id: challenge.id } }).catch(() => undefined);
      store.set(TWO_FACTOR_CHALLENGE_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
      throw new HttpError(401, "Your two-factor challenge expired. Sign in again.");
    }
    const valid = verifyTwoFactorCode(decryptTwoFactorSecret(challenge.user.twoFactorSecretEncrypted, challenge.user.id), code);
    if (!valid) {
      await db.twoFactorChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      throw new HttpError(401, "Authenticator code is incorrect");
    }
    const membership = challenge.user.memberships.find((item) => item.organizationId === challenge.organizationId);
    if (!membership) throw new HttpError(403, "Workspace access is no longer available");
    await db.twoFactorChallenge.delete({ where: { id: challenge.id } });
    const session = await createSession(challenge.user.id, challenge.organizationId, { ip: request.headers.get("x-forwarded-for")?.split(",")[0], userAgent: request.headers.get("user-agent") ?? undefined });
    await db.$transaction([
      db.user.update({ where: { id: challenge.user.id }, data: { lastLoginAt: new Date() } }),
      db.auditLog.create({ data: { organizationId: challenge.organizationId, actorId: challenge.user.id, action: "user.signed_in_2fa", targetType: "User", targetId: challenge.user.id } }),
    ]);
    store.set(TWO_FACTOR_CHALLENGE_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
    store.set(SESSION_COOKIE, session.token, { ...sessionCookieOptions, expires: session.expiresAt });
    return NextResponse.json({ user: { id: challenge.user.id, email: challenge.user.email, name: challenge.user.name }, organization: challenge.organization, role: membership.role });
  } catch (error) { return apiError(error); }
}
