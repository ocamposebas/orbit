import { NextResponse, type NextRequest } from "next/server";
import { encryptRelaySecret } from "@/commerce/woocommerce/crypto";
import { relayConfigurationSchema, validateWooCommerceBaseUrl } from "@/commerce/woocommerce/configuration";
import { relayApiError } from "@/commerce/woocommerce/http";
import { safeRelayIntegration } from "@/commerce/woocommerce/service";
import { RelayError } from "@/commerce/woocommerce/types";
import { getDatabase } from "@/sentinel/db";
import { requireMerchantAccess } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  try {
    const { merchantId } = await params;
    const { session, organization } = await requireMerchantAccess(request, merchantId, { allowedRoles: ["OWNER", "ADMIN"], mutation: true });
    await enforceRateLimit(request, `woo-relay-config:${merchantId}:${session.user.id}`, 10);
    const input = relayConfigurationSchema.parse(await request.json());
    const baseUrl = await validateWooCommerceBaseUrl(input.baseUrl, input.environment);
    const db = getDatabase();
    const existing = await db.wooCommerceRelayIntegration.findUnique({ where: { merchantId } });
    if (!existing && !input.signingSecret) throw new RelayError(400, "RELAY_NOT_CONFIGURED", "Signing secret is required when configuring ORBIT Relay");
    const encryptedSigningSecret = input.signingSecret ? encryptRelaySecret(input.signingSecret, merchantId) : existing!.encryptedSigningSecret;
    const action = existing ? "WOO_RELAY_CONFIGURATION_UPDATED" : "WOO_RELAY_CONFIGURED";
    const toggleAction = !existing || existing.connectionEnabled !== input.connectionEnabled ? input.connectionEnabled ? "WOO_RELAY_ENABLED" : "WOO_RELAY_DISABLED" : undefined;

    const integration = await db.$transaction(async (tx) => {
      const saved = await tx.wooCommerceRelayIntegration.upsert({
        where: { merchantId },
        create: { merchantId, baseUrl, environment: input.environment, connectionEnabled: input.connectionEnabled, encryptedSigningSecret, connectionStatus: "CONFIGURED" },
        update: {
          baseUrl,
          environment: input.environment,
          connectionEnabled: input.connectionEnabled,
          encryptedSigningSecret,
          connectionStatus: "CONFIGURED",
          relayVersion: null,
          woocommerceAvailable: null,
          lastHealthCheckAt: null,
          lastSuccessfulRequestAt: null,
          lastLatencyMs: null,
          lastErrorCode: null,
        },
      });
      const metadata = { merchantId, baseUrl, environment: input.environment, connectionEnabled: input.connectionEnabled, signingSecretUpdated: Boolean(input.signingSecret) };
      await tx.auditLog.create({ data: { organizationId: organization.id, merchantId, actorId: session.user.id, action, targetType: "WooCommerceRelayIntegration", targetId: saved.id, metadata } });
      if (toggleAction) await tx.auditLog.create({ data: { organizationId: organization.id, merchantId, actorId: session.user.id, action: toggleAction, targetType: "WooCommerceRelayIntegration", targetId: saved.id, metadata: { merchantId, baseUrl, environment: input.environment } } });
      return saved;
    });
    return NextResponse.json({ integration: safeRelayIntegration(integration) }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) { return relayApiError(error); }
}
