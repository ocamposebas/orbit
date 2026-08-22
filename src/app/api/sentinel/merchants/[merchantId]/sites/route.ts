import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/sentinel/db";
import { normalizePublicUrl } from "@/sentinel/security/ssrf";
import { apiError, HttpError, requireRole } from "@/sentinel/http";

const schema = z.object({ url: z.string().trim().min(1), environment: z.enum(["PRODUCTION", "CHECKOUT", "LANDING", "SECONDARY", "STAGING"]).default("SECONDARY"), monitoringCadenceMinutes: z.number().int().min(60).max(43_200).default(1440) });
export async function POST(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) { try { const organization = await requireRole(request, ["OWNER", "ADMIN", "ANALYST"]); const { merchantId } = await params; const merchant = await getDatabase().merchant.findFirst({ where: { id: merchantId, organizationId: organization.id } }); if (!merchant) throw new HttpError(404, "Merchant not found"); const input = schema.parse(await request.json()); const url = normalizePublicUrl(input.url); const site = await getDatabase().merchantSite.create({ data: { merchantId, url: url.toString(), normalizedUrl: url.toString(), hostname: url.hostname, environment: input.environment, monitoringCadenceMinutes: input.monitoringCadenceMinutes } }); await getDatabase().auditLog.create({ data: { organizationId: organization.id, merchantId, action: "site.added", targetType: "MerchantSite", targetId: site.id, metadata: { hostname: site.hostname, environment: site.environment } } }); return NextResponse.json({ site }, { status: 201 }); } catch (error) { return apiError(error); } }
