import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicPaymentCheckout } from "@/components/payments/public-payment-checkout";
import { ecwidEnabled } from "@/integrations/ecwid/config";
import { getPublicEcwidCheckout } from "@/integrations/ecwid/service";
import { HttpError } from "@/sentinel/http";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Secure payment",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function PaymentPage({ params }: PageProps<"/pay/[sessionId]">) {
  if (!ecwidEnabled()) notFound();
  const { sessionId } = await params;
  let session;
  try {
    session = await getPublicEcwidCheckout(sessionId);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  }
  return <PublicPaymentCheckout session={session} />;
}
