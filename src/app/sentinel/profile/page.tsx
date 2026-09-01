import { ProfileSecurity } from "@/components/sentinel/profile-security";
import { currentSession } from "@/sentinel/auth/session";
import { redirect } from "next/navigation";

export default async function ProfilePage() {
  const session = await currentSession();
  if (!session) redirect("/login?next=/sentinel/profile");
  return <ProfileSecurity email={session.user.email} role={session.role} twoFactorEnabled={Boolean(session.user.twoFactorEnabledAt)} />;
}
