import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/sentinel/db";
import { verifyPassword } from "@/sentinel/auth/password";
import { sessionCookieOptions } from "@/sentinel/auth/session";
import { apiError, HttpError, validateMutationOrigin } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { EMAIL_LOGIN_CHALLENGE_COOKIE, TWO_FACTOR_CHALLENGE_COOKIE } from "@/sentinel/auth/constants";
import { twoFactorTokenHash } from "@/sentinel/auth/two-factor";
import { createLoginEmailCode, EMAIL_LOGIN_CODE_TTL_MS, loginEmailCodeHash, loginEmailDeliveryErrorCode, maskLoginEmail, sendLoginVerificationEmail } from "@/sentinel/auth/login-email";

const schema = z.object({ email: z.string().trim().email().transform((value) => value.toLowerCase()), password: z.string().min(12).max(128) });
const roleOrder = ["OWNER", "ADMIN", "ANALYST", "REVIEWER", "VIEWER"];

export async function POST(request: NextRequest) {
  try {
    validateMutationOrigin(request);
    await enforceRateLimit(request, "auth-login", 10);
    const input = schema.parse(await request.json());
    const db = getDatabase();
    const user = await db.user.findUnique({ where: { email: input.email }, include: { memberships: { include: { organization: { select: { id: true, name: true } } } } } });
    if (!user?.active || !user.passwordHash || !(await verifyPassword(input.password, user.passwordHash)) || !user.memberships.length) throw new HttpError(401, "Email or password is incorrect");
    const membership = user.memberships.sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role))[0];
    await enforceRateLimit(request, "auth-login-email", 5, user.id);
    const token = randomBytes(32).toString("base64url");
    const code = createLoginEmailCode();
    const expiresAt = new Date(Date.now() + EMAIL_LOGIN_CODE_TTL_MS);
    const tokenHash = twoFactorTokenHash(token);
    const codeHash = loginEmailCodeHash(token, code);
    const challenge = await db.emailLoginChallenge.upsert({
      where: { userId: user.id },
      create: { tokenHash, codeHash, userId: user.id, organizationId: membership.organizationId, expiresAt },
      update: { tokenHash, codeHash, organizationId: membership.organizationId, expiresAt, attempts: 0, sendCount: 1, deliveryStatus: "PENDING", messageId: null, sentAt: null, lastDeliveryErrorCode: null },
    });
    let delivery: { messageId: string };
    try {
      delivery = await sendLoginVerificationEmail({ recipient: user.email, name: user.name, code });
    } catch (error) {
      const errorCode = loginEmailDeliveryErrorCode(error);
      await db.emailLoginChallenge.updateMany({ where: { id: challenge.id, tokenHash }, data: { deliveryStatus: "FAILED", lastDeliveryErrorCode: errorCode } }).catch(() => undefined);
      await db.auditLog.create({ data: { organizationId: membership.organizationId, actorId: user.id, action: "user.login_email_code_failed", targetType: "EmailLoginChallenge", targetId: challenge.id, metadata: { errorCode, sendCount: 1 } } }).catch(() => undefined);
      throw new HttpError(503, "We could not send the sign-in code. Please try again.");
    }
    const recorded = await db.emailLoginChallenge.updateMany({ where: { id: challenge.id, tokenHash }, data: { deliveryStatus: "SENT", messageId: delivery.messageId, sentAt: new Date(), lastDeliveryErrorCode: null } });
    if (recorded.count !== 1) throw new HttpError(409, "A newer sign-in code was requested. Use the most recent email.");
    await db.auditLog.create({ data: { organizationId: membership.organizationId, actorId: user.id, action: "user.login_email_code_sent", targetType: "EmailLoginChallenge", targetId: challenge.id, metadata: { messageId: delivery.messageId, sendCount: 1 } } }).catch(() => undefined);
    const store = await cookies();
    store.set(EMAIL_LOGIN_CHALLENGE_COOKIE, token, { ...sessionCookieOptions, expires: expiresAt });
    store.set(TWO_FACTOR_CHALLENGE_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
    return NextResponse.json({ emailVerificationRequired: true, emailHint: maskLoginEmail(user.email) }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) { return apiError(error); }
}
