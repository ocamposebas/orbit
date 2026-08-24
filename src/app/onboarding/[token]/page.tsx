import type { Metadata } from "next";
import { OnboardingPortal } from "@/components/contracts/onboarding-portal";

export const metadata: Metadata = {
  title: "Secure agreement onboarding",
  description: "ORBIT secure merchant agreement onboarding portal.",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <OnboardingPortal token={token} />;
}
