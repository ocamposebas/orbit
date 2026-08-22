import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hashPassword, verifyPassword } from "@/sentinel/auth/password";
import { requestSession } from "@/sentinel/auth/session";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, validateMutationOrigin } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

const schema = z.object({
  currentPassword: z.string().min(12).max(128),
  newPassword: z.string().min(12).max(128),
}).refine((value) => value.currentPassword !== value.newPassword, {
  message: "The new password must be different",
  path: ["newPassword"],
});

export async function POST(request: NextRequest) {
  try {
    validateMutationOrigin(request);
    await enforceRateLimit(request, "auth-password", 6);
    const session = await requestSession(request);
    if (!session) throw new HttpError(401, "Authentication is required");
    const input = schema.parse(await request.json());
    const db = getDatabase();
    const user = await db.user.findUnique({ where: { id: session.user.id }, select: { passwordHash: true } });
    if (!user?.passwordHash || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new HttpError(401, "Current password is incorrect");
    }

    const passwordHash = await hashPassword(input.newPassword);
    await db.$transaction([
      db.user.update({ where: { id: session.user.id }, data: { passwordHash, passwordUpdatedAt: new Date() } }),
      db.session.deleteMany({ where: { userId: session.user.id, id: { not: session.id } } }),
      db.auditLog.create({ data: { organizationId: session.organizationId, actorId: session.user.id, action: "user.password_changed", targetType: "User", targetId: session.user.id } }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
