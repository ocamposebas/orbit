import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/sentinel/db";
import { hashPassword } from "@/sentinel/auth/password";
import { requestSession } from "@/sentinel/auth/session";
import { apiError, HttpError, requireRole } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

const createUserSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  name: z.string().trim().min(2).max(120),
  password: z.string().min(12).max(128),
  role: z.enum(["ADMIN", "ANALYST", "REVIEWER", "VIEWER"]).default("VIEWER"),
  merchantIds: z.array(z.string().min(1)).default([]),
}).superRefine((input, context) => {
  if (["REVIEWER", "VIEWER"].includes(input.role) && input.merchantIds.length === 0) {
    context.addIssue({ code: "custom", path: ["merchantIds"], message: "Assign at least one merchant to this client account" });
  }
});

const updateMerchantAccessSchema = z.object({
  userId: z.string().min(1),
  merchantIds: z.array(z.string().min(1)),
}).strict();

export async function GET(request: NextRequest) {
  try {
    const organization = await requireRole(request, ["OWNER", "ADMIN"]);
    const db = getDatabase();
    const [memberships, merchants] = await Promise.all([
      db.membership.findMany({
        where: { organizationId: organization.id },
        orderBy: { createdAt: "asc" },
        include: { user: { select: {
          id: true, email: true, name: true, active: true, lastLoginAt: true, createdAt: true,
          merchantAccess: { where: { merchant: { organizationId: organization.id } }, select: { merchant: { select: { id: true, businessName: true } } } },
        } } },
      }),
      db.merchant.findMany({
        where: { organizationId: organization.id }, orderBy: { businessName: "asc" },
        select: { id: true, businessName: true, portalEnabled: true, agreement: { select: { status: true } }, stripeConnect: { select: { displayStatus: true, cardPaymentsStatus: true, payoutsStatus: true } }, sites: { where: { active: true }, take: 1, select: { hostname: true } } },
      }),
    ]);
    return NextResponse.json({
      users: memberships.map((membership) => ({ ...membership.user, role: membership.role, merchantAccess: membership.user.merchantAccess.map(({ merchant }) => merchant) })),
      merchants: merchants.map((merchant) => ({ id: merchant.id, businessName: merchant.businessName, hostname: merchant.sites[0]?.hostname ?? null, portalEnabled: merchant.portalEnabled, agreementStatus: merchant.agreement?.status ?? null, stripeDisplayStatus: merchant.stripeConnect?.displayStatus ?? null, cardPaymentsStatus: merchant.stripeConnect?.cardPaymentsStatus ?? null, payoutsStatus: merchant.stripeConnect?.payoutsStatus ?? null })),
    });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit(request, "user-create", 20);
    const organization = await requireRole(request, ["OWNER", "ADMIN"]);
    const session = await requestSession(request);
    if (!session) throw new HttpError(401, "Authentication is required");
    const input = createUserSchema.parse(await request.json());
    if (input.role === "ADMIN" && session.role !== "OWNER") throw new HttpError(403, "Only an owner can add administrators");
    const merchantIds = [...new Set(input.merchantIds)];
    const db = getDatabase();
    const [validMerchantCount, existingAccount] = await Promise.all([
      db.merchant.count({ where: { id: { in: merchantIds }, organizationId: organization.id } }),
      db.user.findUnique({ where: { email: input.email }, select: { memberships: { where: { organizationId: organization.id }, select: { id: true } } } }),
    ]);
    if (validMerchantCount !== merchantIds.length) throw new HttpError(400, "One or more selected merchants are invalid");
    if (existingAccount && existingAccount.memberships.length === 0) throw new HttpError(409, "This email already belongs to an account outside this workspace");
    const passwordHash = await hashPassword(input.password);
    const scopedRole = input.role === "VIEWER" || input.role === "REVIEWER";
    const user = await db.$transaction(async (tx) => {
      const account = await tx.user.upsert({
        where: { email: input.email },
        update: { name: input.name, passwordHash, passwordUpdatedAt: new Date(), active: true },
        create: { email: input.email, name: input.name, passwordHash, passwordUpdatedAt: new Date() },
      });
      await tx.membership.upsert({ where: { organizationId_userId: { organizationId: organization.id, userId: account.id } }, update: { role: input.role }, create: { organizationId: organization.id, userId: account.id, role: input.role } });
      await tx.merchantAccess.deleteMany({ where: { userId: account.id, merchant: { organizationId: organization.id } } });
      if (scopedRole) await tx.merchantAccess.createMany({ data: merchantIds.map((merchantId) => ({ userId: account.id, merchantId })) });
      await tx.auditLog.create({ data: {
        organizationId: organization.id, actorId: session.user.id, action: "user.access_configured", targetType: "User", targetId: account.id,
        metadata: { role: input.role, merchantIds: scopedRole ? merchantIds : [], access: scopedRole ? "ASSIGNED_MERCHANTS" : "WORKSPACE_WIDE" },
      } });
      return account;
    });
    return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, role: input.role, merchantIds: scopedRole ? merchantIds : [] } }, { status: 201 });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    await enforceRateLimit(request, "user-access-update", 40);
    const organization = await requireRole(request, ["OWNER", "ADMIN"]);
    const session = await requestSession(request);
    if (!session) throw new HttpError(401, "Authentication is required");
    const input = updateMerchantAccessSchema.parse(await request.json());
    const merchantIds = [...new Set(input.merchantIds)];
    const db = getDatabase();
    const [membership, validMerchantCount] = await Promise.all([
      db.membership.findUnique({ where: { organizationId_userId: { organizationId: organization.id, userId: input.userId } }, select: { role: true, user: { select: { id: true, email: true } } } }),
      db.merchant.count({ where: { id: { in: merchantIds }, organizationId: organization.id } }),
    ]);
    if (!membership) throw new HttpError(404, "User not found");
    if (!["VIEWER", "REVIEWER"].includes(membership.role)) throw new HttpError(409, "Workspace-wide roles cannot be limited to selected merchants");
    if (validMerchantCount !== merchantIds.length) throw new HttpError(400, "One or more selected merchants are invalid");
    await db.$transaction(async (tx) => {
      await tx.merchantAccess.deleteMany({ where: { userId: input.userId, merchant: { organizationId: organization.id } } });
      if (merchantIds.length) await tx.merchantAccess.createMany({ data: merchantIds.map((merchantId) => ({ userId: input.userId, merchantId })) });
      await tx.auditLog.create({ data: {
        organizationId: organization.id,
        actorId: session.user.id,
        action: "user.merchant_access_updated",
        targetType: "User",
        targetId: input.userId,
        metadata: { merchantIds, role: membership.role },
      } });
    });
    return NextResponse.json({ user: { id: membership.user.id, email: membership.user.email, role: membership.role, merchantIds } });
  } catch (error) { return apiError(error); }
}
