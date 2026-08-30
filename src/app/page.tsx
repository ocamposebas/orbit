import { Hero } from "@/components/marketing/hero";
import {
  BuiltForSection,
  CustomComplianceSection,
  EvidenceSection,
  FinalCta,
  FindingsSection,
  MerchantHealthSection,
  MonitoringSection,
  SecuritySection,
  SystemSection,
} from "@/components/marketing/home-sections";

export default function Home() {
  return (
    <>
      <Hero />
      <SystemSection />
      <MonitoringSection />
      <FindingsSection />
      <EvidenceSection />
      <MerchantHealthSection />
      <BuiltForSection />
      <CustomComplianceSection />
      <SecuritySection />
      <FinalCta />
    </>
  );
}
