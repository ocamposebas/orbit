import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPortalContext } from "@/merchant-portal/access";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, validateMutationOrigin } from "@/sentinel/http";

const schema = z.object({ monthlyStatementEmailEnabled: z.boolean() });
export async function POST(request: NextRequest) {
  try {
    validateMutationOrigin(request);
    const { merchant, session } = await getPortalContext();
    if (!merchant) throw new HttpError(404, "Merchant not found");
    if (!merchant.canManageStatements) throw new HttpError(403, "This role cannot manage statement notifications");
    const input = schema.parse(await request.json());
    await getDatabase().$transaction([
      getDatabase().merchant.update({ where: { id: merchant.id }, data: input }),
      getDatabase().auditLog.create({ data: { organizationId: merchant.organizationId, merchantId: merchant.id, actorId: session.user.id, action: "STATEMENT_NOTIFICATION_PREFERENCE_UPDATED", targetType: "Merchant", targetId: merchant.id, metadata: input } }),
    ]);
    return NextResponse.json({ saved: true });
  } catch (error) { return apiError(error); }
}
