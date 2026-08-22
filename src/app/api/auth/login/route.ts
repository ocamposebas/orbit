import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/sentinel/db";
import { verifyPassword } from "@/sentinel/auth/password";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/sentinel/auth/session";
import { apiError, HttpError, validateMutationOrigin } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

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
    const session = await createSession(user.id, membership.organizationId, { ip: request.headers.get("x-forwarded-for")?.split(",")[0], userAgent: request.headers.get("user-agent") ?? undefined });
    (await cookies()).set(SESSION_COOKIE, session.token, { ...sessionCookieOptions, expires: session.expiresAt });
    await db.$transaction([db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }), db.auditLog.create({ data: { organizationId: membership.organizationId, actorId: user.id, action: "user.signed_in", targetType: "User", targetId: user.id } })]);
    return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name }, organization: membership.organization, role: membership.role });
  } catch (error) { return apiError(error); }
}
