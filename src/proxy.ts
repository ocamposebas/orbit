import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/sentinel/auth/constants";

export function proxy(request: NextRequest) { if (!request.cookies.has(SESSION_COOKIE)) { const login = new URL("/login", request.url); login.searchParams.set("next", request.nextUrl.pathname); return NextResponse.redirect(login); } return NextResponse.next(); }
export const config = { matcher: ["/sentinel/:path*", "/dashboard/:path*", "/portal-access"] };
