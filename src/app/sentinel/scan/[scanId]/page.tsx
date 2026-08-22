import { LiveScan } from "@/components/sentinel/live-scan";

export default async function Page({ params }: { params: Promise<{ scanId: string }> }) { const { scanId } = await params; return <LiveScan scanId={scanId} />; }
