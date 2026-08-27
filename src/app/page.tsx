import { Hero } from "@/components/marketing/hero";
import { AuditSection, BuiltForSection, ChangesSection, CustomComplianceSection, FinalCta, FindingsSection, MerchantHealthSection, MonitoringSection, ProblemSection, RulesetsSection, SecuritySection } from "@/components/marketing/home-sections";

export default function Home() {
  return (
    <>
      <Hero />
      <ProblemSection />
      <MonitoringSection />
      <FindingsSection />
      <MerchantHealthSection />
      <CustomComplianceSection />
      <ChangesSection />
      <AuditSection />
      <RulesetsSection />
      <BuiltForSection />
      <SecuritySection />
      <FinalCta />
    </>
  );
}
