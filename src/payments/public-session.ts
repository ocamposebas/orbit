import { getPublicWooCommerceCheckout, isHostedPaymentSessionId } from "@/commerce/woocommerce/hosted-payments";
import { ecwidEnabled } from "@/integrations/ecwid/config";
import { getPublicEcwidCheckout, isEcwidSessionId } from "@/integrations/ecwid/service";
import { HttpError } from "@/sentinel/http";

export async function getPublicPaymentSession(sessionId: string) {
  if (isHostedPaymentSessionId(sessionId)) return getPublicWooCommerceCheckout(sessionId);
  if (ecwidEnabled() && isEcwidSessionId(sessionId)) {
    return { ...(await getPublicEcwidCheckout(sessionId)), platform: "ECWID" as const, orderReference: undefined, disabled: false, returnReady: false };
  }
  throw new HttpError(404, "Payment session not found");
}
