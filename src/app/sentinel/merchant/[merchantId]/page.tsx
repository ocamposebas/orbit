import { MerchantDashboard } from "@/components/sentinel/merchant-dashboard";

export default async function Page({ params }: { params: Promise<{ merchantId: string }> }) { const { merchantId } = await params; return <MerchantDashboard merchantId={merchantId} />; }
