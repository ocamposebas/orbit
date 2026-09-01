import QRCode from "qrcode";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createTwoFactorSecret, decryptTwoFactorSecret, encryptTwoFactorSecret, twoFactorProvisioningUri, verifyTwoFactorCode } from "@/sentinel/auth/two-factor";
import { requestSession } from "@/sentinel/auth/session";
import { verifyPassword } from "@/sentinel/auth/password";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, validateMutationOrigin } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).strict();

export async function POST(request: NextRequest) {
  try {
    validateMutationOrigin(request);
    const session = await requestSession(request);
    if (!session) throw new HttpError(401, "Authentication is required");
    await enforceRateLimit(request, "auth-2fa-setup", 5, session.user.id);
    const db = getDatabase();
    const current = await db.user.findUnique({ where: { id: session.user.id }, select: { twoFactorEnabledAt: true } });
    if (current?.twoFactorEnabledAt) throw new HttpError(409, "Two-factor authentication is already enabled");
    const secret = createTwoFactorSecret();
    const uri = twoFactorProvisioningUri(secret, session.user.email);
    await db.user.update({ where: { id: session.user.id }, data: { twoFactorPendingSecretEncrypted: encryptTwoFactorSecret(secret, session.user.id) } });
    return NextResponse.json({ secret, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 240, color: { dark: "#0a0b10", light: "#ffffff" } }) }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) { return apiError(error); }
}

export async function PUT(request: NextRequest) {
  try {
    validateMutationOrigin(request);
    const session = await requestSession(request);
    if (!session) throw new HttpError(401, "Authentication is required");
    await enforceRateLimit(request, "auth-2fa-verify", 8, session.user.id);
    const { code } = codeSchema.parse(await request.json());
    const db = getDatabase();
    const user = await db.user.findUnique({ where: { id: session.user.id }, select: { twoFactorPendingSecretEncrypted: true } });
    if (!user?.twoFactorPendingSecretEncrypted) throw new HttpError(409, "Start two-factor setup first");
    const secret = decryptTwoFactorSecret(user.twoFactorPendingSecretEncrypted, session.user.id);
    if (!verifyTwoFactorCode(secret, code)) throw new HttpError(401, "Authenticator code is incorrect");
    await db.$transaction([
      db.user.update({ where: { id: session.user.id }, data: { twoFactorSecretEncrypted: user.twoFactorPendingSecretEncrypted, twoFactorPendingSecretEncrypted: null, twoFactorEnabledAt: new Date() } }),
      db.auditLog.create({ data: { organizationId: session.organizationId, actorId: session.user.id, action: "user.two_factor_enabled", targetType: "User", targetId: session.user.id } }),
    ]);
    return NextResponse.json({ enabled: true });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: NextRequest) {
  try {
    validateMutationOrigin(request);
    const session = await requestSession(request);
    if (!session) throw new HttpError(401, "Authentication is required");
    await enforceRateLimit(request, "auth-2fa-disable", 5, session.user.id);
    const input = z.object({ password: z.string().min(12).max(128), code: z.string().trim().regex(/^\d{6}$/) }).strict().parse(await request.json());
    const db = getDatabase();
    const user = await db.user.findUnique({ where: { id: session.user.id }, select: { passwordHash: true, twoFactorSecretEncrypted: true } });
    if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) throw new HttpError(401, "Current password is incorrect");
    if (!user.twoFactorSecretEncrypted || !verifyTwoFactorCode(decryptTwoFactorSecret(user.twoFactorSecretEncrypted, session.user.id), input.code)) throw new HttpError(401, "Authenticator code is incorrect");
    await db.$transaction([
      db.user.update({ where: { id: session.user.id }, data: { twoFactorSecretEncrypted: null, twoFactorPendingSecretEncrypted: null, twoFactorEnabledAt: null } }),
      db.session.deleteMany({ where: { userId: session.user.id, id: { not: session.id } } }),
      db.auditLog.create({ data: { organizationId: session.organizationId, actorId: session.user.id, action: "user.two_factor_disabled", targetType: "User", targetId: session.user.id } }),
    ]);
    return NextResponse.json({ enabled: false });
  } catch (error) { return apiError(error); }
}
