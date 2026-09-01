import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { getDatabase } from "@/sentinel/db";
import { getServerEnv } from "@/sentinel/config";
import { SESSION_COOKIE } from "./constants";

export { SESSION_COOKIE } from "./constants";
export const sessionCookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", priority: "high" as const };
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

const sessionInclude = { user: { select: { id: true, email: true, name: true, active: true, memberships: { select: { organizationId: true, role: true, portalAllMerchants: true } } } }, organization: { select: { id: true, name: true, isDemo: true } } } as const;

export async function sessionFromToken(token: string | undefined) {
  if (!token) return null;
  const db = getDatabase();
  const session = await db.session.findUnique({ where: { tokenHash: tokenHash(token) }, include: sessionInclude });
  if (!session || session.expiresAt <= new Date() || !session.user.active) {
    if (session) await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  const membership = session.user.memberships.find((item) => item.organizationId === session.organizationId);
  if (!membership) return null;
  return { ...session, role: membership.role, portalAllMerchants: membership.portalAllMerchants };
}

export async function currentSession() { return sessionFromToken((await cookies()).get(SESSION_COOKIE)?.value); }
export async function requestSession(request: NextRequest) { return sessionFromToken(request.cookies.get(SESSION_COOKIE)?.value); }

export async function createSession(userId: string, organizationId: string, metadata: { ip?: string; userAgent?: string }) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + getServerEnv().SESSION_TTL_DAYS * 86_400_000);
  const ipHash = metadata.ip ? createHash("sha256").update(metadata.ip).digest("hex") : undefined;
  await getDatabase().session.create({ data: { tokenHash: tokenHash(token), userId, organizationId, expiresAt, ipHash, userAgent: metadata.userAgent?.slice(0, 500) } });
  return { token, expiresAt };
}

export async function revokeSession(token: string | undefined) { if (token) await getDatabase().session.deleteMany({ where: { tokenHash: tokenHash(token) } }); }
