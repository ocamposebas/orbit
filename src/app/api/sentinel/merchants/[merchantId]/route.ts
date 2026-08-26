import { NextResponse, type NextRequest } from "next/server";
import { getDatabase } from "@/sentinel/db";
import { apiError, HttpError, requireMerchantAccess } from "@/sentinel/http";
import { childLogger } from "@/sentinel/logger";
import { enforceRateLimit } from "@/sentinel/rate-limit";
import { updateMerchantLegalCountrySchema } from "@/sentinel/services/merchants";
import { safeRelayIntegration } from "@/commerce/woocommerce/service";
import { agreementAdminState } from "@/contracts/service";

export const runtime = "nodejs";
const log = childLogger({ component: "merchant-api" });

function isMissingOptionalIntegrationSchema(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && ["P2021", "P2022"].includes(String(error.code));
}

function isMissingAgreementColumn(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && String(error.code) === "P2022";
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  try {
    const { merchantId } = await params;
    const { organization } = await requireMerchantAccess(request, merchantId);
    const db = getDatabase();
    const merchant = await (async () => {
      try {
        const current = await db.merchant.findFirst({ where: { id: merchantId, organizationId: organization.id }, include: { agreement: { select: { status: true, invitationExpiresAt: true, invitationIssuedAt: true, informationCertifiedAt: true, contractIssuedAt: true, signedUploadedAt: true, signedOriginalName: true, signedSizeBytes: true, lockedAt: true, termsVersion: true } }, sites: true, aiScans: { orderBy: { createdAt: "desc" }, take: 20, include: { _count: { select: { findings: true } }, products: true } }, aiFindings: { orderBy: [{ severity: "asc" }, { createdAt: "desc" }], take: 100, include: { evidence: { include: { evidence: true }, take: 20 } } }, auditLogs: { orderBy: { createdAt: "desc" }, take: 100 } } });
        if (!current) throw new HttpError(404, "Merchant not found");
        return { ...current, agreement: agreementAdminState(current.agreement) };
      } catch (error) {
        if (!isMissingAgreementColumn(error)) throw error;
        log.warn({ merchantId, errorCode: String((error as { code: unknown }).code) }, "Agreement invitation timestamp is not deployed; serving the merchant in compatibility mode");
        const legacy = await db.merchant.findFirst({ where: { id: merchantId, organizationId: organization.id }, include: { agreement: { select: { status: true, invitationExpiresAt: true, informationCertifiedAt: true, contractIssuedAt: true, signedUploadedAt: true, signedOriginalName: true, signedSizeBytes: true, lockedAt: true, termsVersion: true } }, sites: true, aiScans: { orderBy: { createdAt: "desc" }, take: 20, include: { _count: { select: { findings: true } }, products: true } }, aiFindings: { orderBy: [{ severity: "asc" }, { createdAt: "desc" }], take: 100, include: { evidence: { include: { evidence: true }, take: 20 } } }, auditLogs: { orderBy: { createdAt: "desc" }, take: 100 } } });
        if (!legacy) throw new HttpError(404, "Merchant not found");
        return { ...legacy, agreement: agreementAdminState(legacy.agreement ? { ...legacy.agreement, invitationIssuedAt: null } : null) };
      }
    })();
    let stripeConnect = null;
    let stripeConnectAvailable = true;
    try {
      stripeConnect = await db.stripeConnectIntegration.findUnique({ where: { merchantId }, select: { id: true, stripeAccountId: true, stripeEnvironment: true, accountApiVersion: true, displayStatus: true, cardPaymentsStatus: true, payoutsStatus: true, requirementsCurrentlyDue: true, requirementsEventuallyDue: true, requirementsPastDue: true, requirementsPendingVerification: true, futureRequirements: true, statusDetails: true, disabledReason: true, onboardingStartedAt: true, onboardingCompletedAt: true, lastSyncedAt: true, createdAt: true, updatedAt: true } });
    } catch (error) {
      if (!isMissingOptionalIntegrationSchema(error)) throw error;
      stripeConnectAvailable = false;
      log.warn({ merchantId, errorCode: String((error as { code: unknown }).code) }, "Stripe Connect schema is not deployed; serving merchant without the optional integration");
    }
    let wooCommerceRelay = null;
    let wooCommerceRelayAvailable = true;
    try {
      const relay = await db.wooCommerceRelayIntegration.findUnique({ where: { merchantId } });
      wooCommerceRelay = relay ? safeRelayIntegration(relay) : null;
    } catch (error) {
      if (!isMissingOptionalIntegrationSchema(error)) throw error;
      wooCommerceRelayAvailable = false;
      log.warn({ merchantId, errorCode: String((error as { code: unknown }).code) }, "WooCommerce Relay schema is not deployed; serving merchant without the optional integration");
    }
    const { aiScans: returnedAiScans, aiFindings: returnedAiFindings, ...merchantBase } = merchant;
    const aiScans = returnedAiScans ?? [];
    const aiFindings = returnedAiFindings ?? [];
    const scans = aiScans.map((scan) => ({ ...scan, mode: "LUNA_AI", progress: scan.coverage, pagesProcessed: scanCoverageNumber(scan.coverage, "pagesOpened"), productsDetected: scanCoverageValue(scan.coverage, "productsVerified"), policiesDetected: 0, findingsCreated: scan._count.findings, findingsResolved: 0, scoreBefore: null, scoreAfter: scan.score }));
    const findings = aiFindings.map((finding) => ({ ...finding, description: finding.explanation, url: finding.affectedUrl, detectedText: null, reason: finding.explanation, recommendedAction: finding.remediation, lastDetectedAt: finding.createdAt, evidence: finding.evidence.map((link) => ({ ...link.evidence, pageUrl: link.evidence.sourceUrl, normalizedText: link.evidence.exactText, evidenceSnippet: link.evidence.exactText })) }));
    const latest = aiScans[0];
    const scoreBreakdown = latest?.scoreBreakdown as { deductions?: unknown[] } | null;
    const healthScores = latest?.score === null || latest?.score === undefined ? [] : [{ total: latest.score, createdAt: latest.createdAt, components: [{ key: "AI_SCANNER_RISK", label: "Validated Luna findings", score: latest.score, deductions: scoreBreakdown?.deductions ?? [] }] }];
    const products = (latest?.products ?? []).map((product) => ({ ...product, currentPrice: product.price, claims: [], lastSeenAt: product.createdAt, snapshots: [] }));
    return NextResponse.json({ merchant: { ...merchantBase, scans, healthScores, findings, products, policies: [], stripeConnect, stripeConnectAvailable, wooCommerceRelay, wooCommerceRelayAvailable } });
  } catch (error) { return apiError(error); }
}

function scanCoverageNumber(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const item = (value as Record<string, unknown>)[key];
  return Array.isArray(item) ? item.length : typeof item === "number" ? item : 0;
}

function scanCoverageValue(value: unknown, key: string) { return scanCoverageNumber(value, key); }

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  try {
    await enforceRateLimit(request, "merchant-update", 30);
    const { merchantId } = await params;
    const { session, organization, merchant } = await requireMerchantAccess(request, merchantId, { allowedRoles: ["OWNER", "ADMIN"], mutation: true });
    const input = updateMerchantLegalCountrySchema.parse(await request.json());
    const db = getDatabase();
    const integration = await db.stripeConnectIntegration.findUnique({ where: { merchantId }, select: { id: true } });
    if (integration && merchant.legalCountry && input.legalCountry !== merchant.legalCountry) {
      throw new HttpError(409, "The legal business country cannot be changed after Stripe is connected");
    }
    const updated = await db.merchant.update({ where: { id: merchantId }, data: { legalCountry: input.legalCountry }, select: { id: true, legalCountry: true } });
    await db.auditLog.create({ data: {
      organizationId: organization.id,
      merchantId,
      actorId: session.user.id,
      action: "MERCHANT_LEGAL_COUNTRY_UPDATED",
      targetType: "Merchant",
      targetId: merchantId,
      metadata: { previousLegalCountry: merchant.legalCountry, legalCountry: input.legalCountry },
    } });
    return NextResponse.json({ merchant: updated });
  } catch (error) { return apiError(error); }
}
