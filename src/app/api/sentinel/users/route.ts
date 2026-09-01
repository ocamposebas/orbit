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
  portalAllMerchants: z.boolean().default(false),
  merchantIds: z.array(z.string().min(1)).default([]),
  payoutMerchantIds: z.array(z.string().min(1)).default([]),
});

const updateMerchantAccessSchema = z.object({
  userId: z.string().min(1),
  portalAllMerchants: z.boolean(),
  merchantIds: z.array(z.string().min(1)),
  payoutMerchantIds: z.array(z.string().min(1)).default([]),
}).strict();

function accessRows(visibleMerchantIds: string[], payoutMerchantIds: string[], allMerchants: boolean) {
  const visible = new Set(visibleMerchantIds);
  const payout = new Set(payoutMerchantIds);
  const rowIds = allMerchants ? payout : visible;
  return [...rowIds].map((merchantId) => ({ merchantId, canInitiatePayouts: payout.has(merchantId) }));
}

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
          merchantAccess: { where: { merchant: { organizationId: organization.id } }, select: { canInitiatePayouts: true, merchant: { select: { id: true, businessName: true } } } },
        } } },
      }),
      db.merchant.findMany({
        where: { organizationId: organization.id }, orderBy: { businessName: "asc" },
        select: { id: true, businessName: true, portalEnabled: true, agreement: { select: { status: true } }, stripeConnect: { select: { displayStatus: true, cardPaymentsStatus: true, payoutsStatus: true } }, sites: { where: { active: true }, take: 1, select: { hostname: true } } },
      }),
    ]);
    return NextResponse.json({
      users: memberships.map((membership) => ({ ...membership.user, role: membership.role, portalAllMerchants: membership.role === "OWNER" || membership.portalAllMerchants, merchantAccess: membership.user.merchantAccess.map(({ merchant, canInitiatePayouts }) => ({ ...merchant, canInitiatePayouts })) })),
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
    const payoutMerchantIds = [...new Set(input.payoutMerchantIds)];
    if (!input.portalAllMerchants && payoutMerchantIds.some((merchantId) => !merchantIds.includes(merchantId))) throw new HttpError(400, "Transfer access requires visibility for the same brand");
    const accessMerchantIds = [...new Set([...merchantIds, ...payoutMerchantIds])];
    const db = getDatabase();
    const [validMerchantCount, existingAccount] = await Promise.all([
      db.merchant.count({ where: { id: { in: accessMerchantIds }, organizationId: organization.id } }),
      db.user.findUnique({ where: { email: input.email }, select: { memberships: { where: { organizationId: organization.id }, select: { id: true } } } }),
    ]);
    if (validMerchantCount !== accessMerchantIds.length) throw new HttpError(400, "One or more selected merchants are invalid");
    if (existingAccount && existingAccount.memberships.length === 0) throw new HttpError(409, "This email already belongs to an account outside this workspace");
    const passwordHash = await hashPassword(input.password);
    const user = await db.$transaction(async (tx) => {
      const account = await tx.user.upsert({
        where: { email: input.email },
        update: { name: input.name, passwordHash, passwordUpdatedAt: new Date(), active: true },
        create: { email: input.email, name: input.name, passwordHash, passwordUpdatedAt: new Date() },
      });
      await tx.membership.upsert({ where: { organizationId_userId: { organizationId: organization.id, userId: account.id } }, update: { role: input.role, portalAllMerchants: input.portalAllMerchants }, create: { organizationId: organization.id, userId: account.id, role: input.role, portalAllMerchants: input.portalAllMerchants } });
      await tx.merchantAccess.deleteMany({ where: { userId: account.id, merchant: { organizationId: organization.id } } });
      const grants = accessRows(merchantIds, payoutMerchantIds, input.portalAllMerchants);
      if (grants.length) await tx.merchantAccess.createMany({ data: grants.map((grant) => ({ userId: account.id, ...grant })) });
      await tx.auditLog.create({ data: {
        organizationId: organization.id, actorId: session.user.id, action: "user.access_configured", targetType: "User", targetId: account.id,
        metadata: { role: input.role, merchantIds: input.portalAllMerchants ? [] : merchantIds, payoutMerchantIds, access: input.portalAllMerchants ? "ALL_MERCHANTS" : "ASSIGNED_MERCHANTS" },
      } });
      return account;
    });
    return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, role: input.role, portalAllMerchants: input.portalAllMerchants, merchantIds: input.portalAllMerchants ? [] : merchantIds, payoutMerchantIds } }, { status: 201 });
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
    const payoutMerchantIds = [...new Set(input.payoutMerchantIds)];
    if (!input.portalAllMerchants && payoutMerchantIds.some((merchantId) => !merchantIds.includes(merchantId))) throw new HttpError(400, "Transfer access requires visibility for the same brand");
    const accessMerchantIds = [...new Set([...merchantIds, ...payoutMerchantIds])];
    const db = getDatabase();
    const [membership, validMerchantCount] = await Promise.all([
      db.membership.findUnique({ where: { organizationId_userId: { organizationId: organization.id, userId: input.userId } }, select: { role: true, portalAllMerchants: true, user: { select: { id: true, email: true } } } }),
      db.merchant.count({ where: { id: { in: accessMerchantIds }, organizationId: organization.id } }),
    ]);
    if (!membership) throw new HttpError(404, "User not found");
    if (membership.role === "OWNER") throw new HttpError(409, "The workspace owner always has access to every merchant");
    if (membership.role === "ADMIN" && session.role !== "OWNER") throw new HttpError(403, "Only the owner can change another administrator's financial access");
    if (validMerchantCount !== accessMerchantIds.length) throw new HttpError(400, "One or more selected merchants are invalid");
    await db.$transaction(async (tx) => {
      await tx.merchantAccess.deleteMany({ where: { userId: input.userId, merchant: { organizationId: organization.id } } });
      await tx.membership.update({ where: { organizationId_userId: { organizationId: organization.id, userId: input.userId } }, data: { portalAllMerchants: input.portalAllMerchants } });
      const grants = accessRows(merchantIds, payoutMerchantIds, input.portalAllMerchants);
      if (grants.length) await tx.merchantAccess.createMany({ data: grants.map((grant) => ({ userId: input.userId, ...grant })) });
      await tx.auditLog.create({ data: {
        organizationId: organization.id,
        actorId: session.user.id,
        action: "user.merchant_access_updated",
        targetType: "User",
        targetId: input.userId,
        metadata: { merchantIds: input.portalAllMerchants ? [] : merchantIds, payoutMerchantIds, portalAllMerchants: input.portalAllMerchants, role: membership.role },
      } });
    });
    return NextResponse.json({ user: { id: membership.user.id, email: membership.user.email, role: membership.role, portalAllMerchants: input.portalAllMerchants, merchantIds: input.portalAllMerchants ? [] : merchantIds, payoutMerchantIds } });
  } catch (error) { return apiError(error); }
}
