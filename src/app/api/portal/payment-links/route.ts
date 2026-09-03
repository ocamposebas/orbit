import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/sentinel/db";
import { requestSession } from "@/sentinel/auth/session";
import { apiError, HttpError, portalMerchantScope, validateMutationOrigin } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { getStripeConfiguration, stripeEnvironment } from "@/stripe/client";
import { parseAppUrlConfiguration } from "@/sentinel/app-url";
import { getServerEnv } from "@/sentinel/config";
import { randomBytes } from "node:crypto";

const supportedCurrencies = ["USD", "COP", "EUR", "GBP", "CAD", "MXN"] as const;
const createSchema = z.object({
  merchantId: z.string().min(1).nullable(),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  amountMinor: z.number().int().min(100).max(999_999_999),
  currency: z.enum(supportedCurrencies),
  expiresAt: z.string().datetime().nullable().optional(),
}).strict();

function publicId() { return `plink_${randomBytes(18).toString("base64url")}`; }

export async function GET(request: NextRequest) {
  try {
    const session = await requestSession(request);
    if (!session) throw new HttpError(401, "Authentication is required");
    const privileged = ["OWNER", "ADMIN"].includes(session.role);
    const permittedMerchantIds = privileged ? [] : (await getDatabase().merchantAccess.findMany({ where: { userId: session.user.id, canCreatePaymentLinks: true, merchant: { organizationId: session.organization.id } }, select: { merchantId: true } })).map((grant) => grant.merchantId);
    if (!privileged && permittedMerchantIds.length === 0) throw new HttpError(403, "Payment Links access has not been enabled. Contact your ORBIT administrator.");
    const links = await getDatabase().orbitPaymentLink.findMany({
      where: {
        organizationId: session.organization.id,
        ...(session.role === "OWNER" ? {} : { merchantId: { not: null } }),
        ...(!privileged ? { merchantId: { in: permittedMerchantIds }, merchant: portalMerchantScope(session) } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        merchant: { select: { businessName: true } },
        createdBy: { select: { name: true, email: true } },
        payments: { select: { amountMinor: true, status: true } },
      },
    });
    return NextResponse.json({ links: links.map((link) => ({
      id: link.id, publicId: link.publicId, title: link.title, description: link.description,
      amountMinor: link.amountMinor, currency: link.currency, status: link.status,
      expiresAt: link.expiresAt?.toISOString() ?? null, createdAt: link.createdAt.toISOString(),
      accountName: link.merchant?.businessName ?? "ORBIT", platformOwned: !link.merchantId,
      createdBy: link.createdBy.name ?? link.createdBy.email,
      paymentCount: link.payments.length,
      paidCount: link.payments.filter((payment) => payment.status === "SUCCEEDED").length,
      collectedMinor: link.payments.filter((payment) => payment.status === "SUCCEEDED").reduce((sum, payment) => sum + payment.amountMinor, 0),
    })) }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    validateMutationOrigin(request);
    const session = await requestSession(request);
    if (!session) throw new HttpError(401, "Authentication is required");
    await enforceRateLimit(request, "payment-link-create", 20, session.user.id);
    const input = createSchema.parse(await request.json());
    const db = getDatabase();
    const privileged = ["OWNER", "ADMIN"].includes(session.role);
    let merchant: { id: string; organizationId: string; businessName: string; portalEnabled: boolean; platformFeeBps: number | null; stripeConnect: { stripeEnvironment: "TEST" | "LIVE"; cardPaymentsStatus: string | null } | null; accessGrants: Array<{ canCreatePaymentLinks: boolean }> } | null = null;

    if (input.merchantId) {
      merchant = await db.merchant.findFirst({
        where: { id: input.merchantId, ...portalMerchantScope(session) },
        select: { id: true, organizationId: true, businessName: true, portalEnabled: true, platformFeeBps: true, stripeConnect: { select: { stripeEnvironment: true, cardPaymentsStatus: true } }, accessGrants: { where: { userId: session.user.id }, select: { canCreatePaymentLinks: true } } },
      });
      if (!merchant) throw new HttpError(404, "ORBIT Payment account not found");
      if (!privileged && !merchant.accessGrants[0]?.canCreatePaymentLinks) throw new HttpError(403, "Payment Links access has not been enabled. Contact your ORBIT administrator.");
      if (!privileged && !merchant.portalEnabled) throw new HttpError(409, "This ORBIT Payment account is not active in the client portal");
      if (!merchant.stripeConnect || merchant.stripeConnect.cardPaymentsStatus?.toLowerCase() !== "active") throw new HttpError(409, "This ORBIT Payment account cannot accept Payment Links yet");
      if (merchant.platformFeeBps === null || merchant.platformFeeBps <= 0 || merchant.platformFeeBps >= 10_000) throw new HttpError(409, "This account needs a valid ORBIT processing fee before Payment Links can be enabled");
    } else if (session.role !== "OWNER") {
      throw new HttpError(403, "Only the ORBIT owner can create platform payment links");
    }

    const config = getStripeConfiguration();
    if (!config.configured) throw new HttpError(503, "ORBIT Payment is not configured");
    if (!merchant && !config.platformPaymentsWebhookConfigured) throw new HttpError(503, "Configure the ORBIT platform payment webhook before publishing platform links");
    const environment = stripeEnvironment(config.mode);
    if (merchant?.stripeConnect?.stripeEnvironment && merchant.stripeConnect.stripeEnvironment !== environment) throw new HttpError(409, "This account belongs to a different Stripe environment");
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && (expiresAt <= new Date() || expiresAt.getTime() > Date.now() + 366 * 86_400_000)) throw new HttpError(400, "Choose an expiration within the next 366 days");

    const link = await db.$transaction(async (tx) => {
      const created = await tx.orbitPaymentLink.create({ data: {
        publicId: publicId(), organizationId: session.organization.id, merchantId: merchant?.id ?? null,
        createdById: session.user.id, title: input.title, description: input.description || null,
        amountMinor: input.amountMinor, currency: input.currency, platformFeeBps: merchant?.platformFeeBps ?? null,
        stripeEnvironment: environment, expiresAt,
      } });
      await tx.auditLog.create({ data: {
        organizationId: session.organization.id, actorId: session.user.id, merchantId: merchant?.id ?? null,
        action: "orbit_payment.link_created", targetType: "OrbitPaymentLink", targetId: created.id,
        metadata: { publicId: created.publicId, amountMinor: created.amountMinor, currency: created.currency, destination: merchant ? "MERCHANT" : "ORBIT_PLATFORM" },
      } });
      return created;
    });
    const origin = parseAppUrlConfiguration(getServerEnv().APP_URL).canonicalOrigin;
    return NextResponse.json({ link: { id: link.id, publicId: link.publicId, url: `${origin}/pay/orbit/${link.publicId}`, status: link.status } }, { status: 201, headers: { "Cache-Control": "no-store, private" } });
  } catch (error) { return apiError(error); }
}
