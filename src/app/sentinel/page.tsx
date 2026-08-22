import { Watchtower } from "@/components/sentinel/watchtower";
import { currentSession } from "@/sentinel/auth/session";
import { getDatabase } from "@/sentinel/db";
import { redirect } from "next/navigation";

export default async function Page() {
  const session = await currentSession();
  if (session && ["VIEWER", "REVIEWER"].includes(session.role)) {
    const grants = await getDatabase().merchantAccess.findMany({
      where: { userId: session.user.id, merchant: { organizationId: session.organization.id } },
      take: 2,
      select: { merchantId: true },
    });
    if (grants.length === 1) redirect(`/sentinel/merchant/${grants[0].merchantId}`);
  }
  return <Watchtower />;
}
