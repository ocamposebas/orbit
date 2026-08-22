import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { apiError, requireOrganization } from "@/sentinel/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const organization = await requireOrganization(request);
    return NextResponse.json({ organization });
  } catch (error) { return apiError(error); }
}
