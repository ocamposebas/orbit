import { NextResponse } from "next/server";
import { currentSession } from "@/sentinel/auth/session";

export const dynamic = "force-dynamic";
export async function GET() { const session = await currentSession(); if (!session) return NextResponse.json({ authenticated: false }, { status: 401 }); return NextResponse.json({ authenticated: true, user: session.user, organization: session.organization, role: session.role }, { headers: { "Cache-Control": "no-store" } }); }
