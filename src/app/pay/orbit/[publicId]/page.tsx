import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrbitPaymentLinkCheckout } from "@/components/payment-links/orbit-payment-link-checkout";
import { getPublicOrbitPaymentLink } from "@/payment-links/service";
import { HttpError } from "@/sentinel/http";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Secure payment · ORBIT", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

export default async function OrbitPaymentLinkPage({ params, searchParams }: PageProps<"/pay/orbit/[publicId]">) {
  const [{ publicId }, query] = await Promise.all([params, searchParams]);
  let link;
  try { link = await getPublicOrbitPaymentLink(publicId); }
  catch (error) { if (error instanceof HttpError && error.status === 404) notFound(); throw error; }
  const payment = typeof query.payment === "string" && /^plpay_[A-Za-z0-9_-]{16,64}$/.test(query.payment) ? query.payment : null;
  return <OrbitPaymentLinkCheckout link={link} initialPaymentId={payment} />;
}
