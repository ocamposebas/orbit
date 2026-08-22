import type { Metadata } from "next";
import { LegalShell } from "@/components/legal/legal-shell";

export const metadata: Metadata = { title: "Refund & Cancellation Policy", description: "ORBIT B2B SaaS subscription cancellation and refund policy." };

export default function RefundPage() {
  return <LegalShell title="Refund & Cancellation Policy" summary="This policy explains cancellation, renewal, and refund handling for ORBIT B2B software subscriptions.">
    <h2>1. Subscription terms</h2><p>ORBIT subscriptions are sold for the term and billing cadence stated in the applicable order form or checkout. A subscription may be monthly, annual, or another mutually agreed term. Usage-based or implementation fees may be stated separately.</p>
    <h2>2. Cancellation</h2><p>Customers may request cancellation by contacting the configured support email or using an in-product cancellation control when available. Unless an order form states otherwise, cancellation stops automatic renewal and takes effect at the end of the current paid billing period. Access remains available through that period, subject to these Terms.</p>
    <h2>3. Renewal</h2><p>Subscriptions renew according to the order form unless cancelled before the renewal date. Any notice period required for annual or negotiated contracts will be shown in the order form. ORBIT will not rely on a different cancellation period that was not disclosed to the customer.</p>
    <h2>4. Refunds</h2><p>Except where required by law or expressly stated in an order form, paid subscription fees are non-refundable once a billing period begins. ORBIT may issue a credit or refund at its discretion for duplicate billing, a confirmed billing error, or a material failure to provide contracted service that ORBIT cannot remedy within a reasonable period.</p>
    <h2>5. Trials and pilots</h2><p>If ORBIT offers a trial or pilot, its duration, included use, conversion terms, and any fees will be disclosed before the customer begins. A free trial will not convert to a paid subscription without the customer being shown the applicable commercial terms and providing the required authorization.</p>
    <h2>6. Setup and custom work</h2><p>Initial setup, custom configuration, and professional-service fees are generally non-refundable after the work begins because they cover reserved capacity and completed work. Any different milestone or cancellation treatment will be stated in the applicable order form.</p>
    <h2>7. How to request cancellation or billing review</h2><p>Send the workspace name, company name, authorized contact, and reason for the request to the configured support email. Do not include passwords or unnecessary confidential information. ORBIT will confirm receipt and explain the effective cancellation date or information needed to review a billing issue.</p>
  </LegalShell>;
}
