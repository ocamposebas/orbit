import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, requireRole } from "@/sentinel/http";
import { generateMerchantStatements } from "@/statements/service";

const inputSchema = z.object({ merchantId: z.string().min(1), year: z.number().int().min(2020).max(2200), month: z.number().int().min(1).max(12), dryRun: z.boolean().default(true) });
const jsonSafe = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item));

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    const organization = await requireRole(request, ["OWNER", "ADMIN"]);
    const input = inputSchema.parse(await request.json());
    const merchant = await getDatabase().merchant.findFirst({ where: { id: input.merchantId, organizationId: organization.id }, select: { id: true } });
    if (!merchant) throw new HttpError(404, "Merchant not found");
    const result = await generateMerchantStatements({ ...input, actorId: undefined, requestId });
    return NextResponse.json(jsonSafe(result));
  } catch (error) { return apiError(error, requestId); }
}
