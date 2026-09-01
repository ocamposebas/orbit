import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { revokeSession, SESSION_COOKIE, sessionCookieOptions } from "@/sentinel/auth/session";
import { apiError, validateMutationOrigin } from "@/sentinel/http";
import { TWO_FACTOR_CHALLENGE_COOKIE } from "@/sentinel/auth/constants";

export async function POST(request: NextRequest) {
  try {
    validateMutationOrigin(request);
    const store = await cookies();
    await revokeSession(store.get(SESSION_COOKIE)?.value);
    store.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
    store.set(TWO_FACTOR_CHALLENGE_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
