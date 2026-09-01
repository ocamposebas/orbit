import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { getServerEnv } from "./config";
import { appOriginIsAllowed } from "./app-url";
import { requestSession } from "./auth/session";
import { getDatabase } from "./db";

export async function requireOrganization(request: NextRequest) {
  const session = await requestSession(request);
  if (!session) throw new HttpError(401, "Authentication is required");
  return session.organization;
}

type Role = "OWNER" | "ADMIN" | "ANALYST" | "REVIEWER" | "VIEWER";
const workspaceWideRoles: Role[] = ["OWNER", "ADMIN", "ANALYST"];

export function hasWorkspaceWideMerchantAccess(role: string) {
  return workspaceWideRoles.includes(role as Role);
}

export function merchantScope(session: { role: string; user: { id: string }; organization: { id: string } }) {
  return {
    organizationId: session.organization.id,
    ...(hasWorkspaceWideMerchantAccess(session.role) ? {} : { accessGrants: { some: { userId: session.user.id } } }),
  };
}

export function portalMerchantScope(session: { role: string; portalAllMerchants?: boolean; user: { id: string }; organization: { id: string } }) {
  return {
    organizationId: session.organization.id,
    ...(session.role === "OWNER" || session.portalAllMerchants ? {} : { accessGrants: { some: { userId: session.user.id } } }),
  };
}

export async function requireMerchantAccess(
  request: NextRequest,
  merchantId: string,
  options: { allowedRoles?: Role[]; mutation?: boolean } = {},
) {
  const session = await requestSession(request);
  if (!session) throw new HttpError(401, "Authentication is required");
  if (options.allowedRoles && !options.allowedRoles.includes(session.role)) throw new HttpError(403, "This role cannot perform the requested action");
  if (options.mutation) validateMutationOrigin(request);
  const merchant = await getDatabase().merchant.findFirst({ where: { id: merchantId, ...merchantScope(session) } });
  if (!merchant) throw new HttpError(404, "Merchant not found");
  return { session, organization: session.organization, merchant };
}

export function validateMutationOrigin(request: NextRequest) { const origin = request.headers.get("origin"); if (origin && !appOriginIsAllowed(getServerEnv().APP_URL, origin)) throw new HttpError(403, "Cross-origin mutation rejected"); }
export async function requireRole(request: NextRequest, allowed: Role[]) {
  const session = await requestSession(request);
  if (!session) throw new HttpError(401, "Authentication is required");
  if (!allowed.includes(session.role)) throw new HttpError(403, "This role cannot perform the requested action");
  validateMutationOrigin(request);
  return session.organization;
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "HttpError"; }
}

function prismaErrorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return String(error.code);
}

export function apiError(error: unknown, requestId?: string) {
  const headers = {
    "Cache-Control": "no-store, private",
    ...(requestId ? { "X-ORBIT-Request-ID": requestId } : {}),
  };
  if (error instanceof HttpError) return NextResponse.json({ error: error.message, requestId }, { status: error.status, headers });
  if (error instanceof ZodError) return NextResponse.json({ error: "Invalid request", fields: error.flatten().fieldErrors, requestId }, { status: 400, headers });
  console.error(error);
  const databaseCode = prismaErrorCode(error);
  if (databaseCode && ["P2021", "P2022"].includes(databaseCode)) {
    return NextResponse.json({ error: "A database update is still being applied. Please retry shortly.", requestId }, { status: 503, headers });
  }
  if (databaseCode && ["P1001", "P1002", "P1017"].includes(databaseCode)) {
    return NextResponse.json({ error: "The database is temporarily unavailable. Please retry shortly.", requestId }, { status: 503, headers });
  }
  return NextResponse.json({ error: "Unexpected server error", requestId }, { status: 500, headers });
}
