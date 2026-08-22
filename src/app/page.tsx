import { Hero } from "@/components/marketing/hero";
import { AuditSection, BuiltForSection, ChangesSection, FinalCta, FindingsSection, MerchantHealthSection, MonitoringSection, PaymentsSection, ProblemSection, RulesetsSection, SecuritySection } from "@/components/marketing/home-sections";

export default function Home() {
  return (
    <>
      <Hero />
      <ProblemSection />
      <MonitoringSection />
      <FindingsSection />
      <MerchantHealthSection />
      <ChangesSection />
      <AuditSection />
      <RulesetsSection />
      <PaymentsSection />
      <BuiltForSection />
      <SecuritySection />
      <FinalCta />
    </>
  );
}
