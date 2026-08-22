import { MerchantDashboard } from "@/components/sentinel/merchant-dashboard";

export default async function Page({ params, searchParams }: { params: Promise<{ merchantId: string }>; searchParams: Promise<{ stripeReturn?: string | string[] }> }) { const [{ merchantId }, query] = await Promise.all([params, searchParams]); const stripeReturn = typeof query.stripeReturn === "string" ? query.stripeReturn : ""; return <MerchantDashboard merchantId={merchantId} stripeReturn={stripeReturn} />; }
