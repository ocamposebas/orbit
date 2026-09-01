import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicWooCommerceCheckout } from "@/commerce/woocommerce/hosted-payments";
import { PublicPaymentCheckout } from "@/components/payments/public-payment-checkout";
import { HttpError } from "@/sentinel/http";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Secure payment",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function WooCommercePaymentPage({ params }: PageProps<"/p/[sessionId]">) {
  const { sessionId } = await params;
  let session;
  try {
    session = await getPublicWooCommerceCheckout(sessionId);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  }
  return <PublicPaymentCheckout session={session} />;
}
