import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/sentinel/db";
import { getServerEnv } from "@/sentinel/config";
import { apiError, HttpError } from "@/sentinel/http";
import { hashPassword } from "@/sentinel/auth/password";

const schema = z.object({ name: z.string().trim().min(2).max(120), slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60), ownerEmail: z.string().email().transform((value) => value.toLowerCase()), ownerName: z.string().trim().min(2).max(120), ownerPassword: z.string().min(12).max(128) });
export async function POST(request: NextRequest) {
  try {
    if (request.headers.get("x-orbit-setup-secret") !== getServerEnv().INTERNAL_JOB_SECRET) throw new HttpError(401, "A valid setup credential is required");
    const input = schema.parse(await request.json()); const db = getDatabase(); const passwordHash = await hashPassword(input.ownerPassword);
    const organization = await db.$transaction(async (tx) => { const org = await tx.organization.create({ data: { name: input.name, slug: input.slug } }); const user = await tx.user.upsert({ where: { email: input.ownerEmail }, update: { name: input.ownerName, passwordHash, passwordUpdatedAt: new Date(), active: true }, create: { email: input.ownerEmail, name: input.ownerName, passwordHash, passwordUpdatedAt: new Date() } }); await tx.membership.create({ data: { organizationId: org.id, userId: user.id, role: "OWNER" } }); await tx.auditLog.create({ data: { organizationId: org.id, actorId: user.id, action: "organization.created", targetType: "Organization", targetId: org.id } }); return org; });
    return NextResponse.json({ organization }, { status: 201 });
  } catch (error) { return apiError(error); }
}
