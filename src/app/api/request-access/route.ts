import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const data = await request.json().catch(() => null);
  const required = ["firstName", "lastName", "email", "company", "website", "industry", "volume", "role"];
  if (!data || required.some((key) => typeof data[key] !== "string" || !data[key].trim())) return NextResponse.json({ ok: false, error: "Missing required fields" }, { status: 400 });
  console.info("ORBIT access request received by local endpoint", { company: data.company, industry: data.industry, receivedAt: new Date().toISOString() });
  return NextResponse.json({ ok: true, delivery: "local-only" }, { status: 202 });
}
