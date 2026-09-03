import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { EMAIL_LOGIN_CHALLENGE_COOKIE } from "@/sentinel/auth/constants";
import { createLoginEmailCode, EMAIL_LOGIN_CODE_TTL_MS, EMAIL_LOGIN_MAX_SENDS, loginEmailCodeHash, loginEmailDeliveryErrorCode, maskLoginEmail, sendLoginVerificationEmail } from "@/sentinel/auth/login-email";
import { sessionCookieOptions } from "@/sentinel/auth/session";
import { twoFactorTokenHash } from "@/sentinel/auth/two-factor";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, validateMutationOrigin } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export async function POST(request: NextRequest) {
  try {
    validateMutationOrigin(request);
    await enforceRateLimit(request, "auth-email-code-resend", EMAIL_LOGIN_MAX_SENDS);
    const store = await cookies();
    const token = store.get(EMAIL_LOGIN_CHALLENGE_COOKIE)?.value;
    if (!token) throw new HttpError(401, "Your email verification expired. Sign in again.");
    const db = getDatabase();
    const challenge = await db.emailLoginChallenge.findUnique({
      where: { tokenHash: twoFactorTokenHash(token) },
      include: { user: { select: { id: true, email: true, name: true, active: true } } },
    });
    if (!challenge || challenge.expiresAt <= new Date() || !challenge.user.active) {
      if (challenge) await db.emailLoginChallenge.delete({ where: { id: challenge.id } }).catch(() => undefined);
      store.set(EMAIL_LOGIN_CHALLENGE_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
      throw new HttpError(401, "Your email verification expired. Sign in again.");
    }
    if (challenge.sendCount >= EMAIL_LOGIN_MAX_SENDS) throw new HttpError(429, "The resend limit was reached. Sign in again to request a new code.");
    await enforceRateLimit(request, "auth-email-code-resend-user", EMAIL_LOGIN_MAX_SENDS, challenge.userId);
    const code = createLoginEmailCode();
    const expiresAt = new Date(Date.now() + EMAIL_LOGIN_CODE_TTL_MS);
    const sendCount = challenge.sendCount + 1;
    const codeHash = loginEmailCodeHash(token, code);
    const claimed = await db.emailLoginChallenge.updateMany({ where: { id: challenge.id, sendCount: challenge.sendCount }, data: { codeHash, expiresAt, attempts: 0, sendCount: { increment: 1 }, deliveryStatus: "PENDING", messageId: null, sentAt: null, lastDeliveryErrorCode: null } });
    if (claimed.count !== 1) throw new HttpError(409, "Another sign-in code was just sent. Use the most recent email.");
    let delivery: { messageId: string };
    try {
      delivery = await sendLoginVerificationEmail({ recipient: challenge.user.email, name: challenge.user.name, code });
    } catch (error) {
      const errorCode = loginEmailDeliveryErrorCode(error);
      await db.emailLoginChallenge.updateMany({ where: { id: challenge.id, codeHash }, data: { deliveryStatus: "FAILED", lastDeliveryErrorCode: errorCode } }).catch(() => undefined);
      await db.auditLog.create({ data: { organizationId: challenge.organizationId, actorId: challenge.user.id, action: "user.login_email_code_failed", targetType: "EmailLoginChallenge", targetId: challenge.id, metadata: { errorCode, sendCount } } }).catch(() => undefined);
      throw new HttpError(503, "We could not resend the sign-in code. Please try again.");
    }
    const recorded = await db.emailLoginChallenge.updateMany({ where: { id: challenge.id, codeHash }, data: { deliveryStatus: "SENT", messageId: delivery.messageId, sentAt: new Date() } });
    if (recorded.count !== 1) throw new HttpError(409, "A newer sign-in code was requested. Use the most recent email.");
    await db.auditLog.create({ data: { organizationId: challenge.organizationId, actorId: challenge.user.id, action: "user.login_email_code_resent", targetType: "EmailLoginChallenge", targetId: challenge.id, metadata: { messageId: delivery.messageId, sendCount } } }).catch(() => undefined);
    store.set(EMAIL_LOGIN_CHALLENGE_COOKIE, token, { ...sessionCookieOptions, expires: expiresAt });
    return NextResponse.json({ sent: true, emailHint: maskLoginEmail(challenge.user.email) }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) { return apiError(error); }
}
