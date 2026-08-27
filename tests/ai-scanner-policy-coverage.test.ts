import { describe, expect, it } from "vitest";
import { deriveAiPolicyCoverage } from "@/ai-scanner/policy-coverage";

describe("AI Scanner v1 policy coverage", () => {
  it("distinguishes an observed link from a substantively opened policy", () => {
    const evidence = [
      { toolName: "inspect_footer", kind: "VISUAL_REGION", sourceUrl: "https://merchant.example/", destinationUrl: null, exactText: "Policies", metadata: {}, surroundingDom: { links: [{ href: "https://merchant.example/privacy-policy" }, { href: "https://merchant.example/terms" }] } },
      { toolName: "inspect_policy", kind: "PAGE_SNAPSHOT", sourceUrl: "https://merchant.example/privacy-policy", destinationUrl: null, exactText: "Privacy policy ".repeat(20), metadata: { policyType: "PRIVACY", substantive: true }, surroundingDom: {} },
    ];
    const coverage = deriveAiPolicyCoverage(evidence, true);
    expect(coverage.find((item) => item.type === "PRIVACY")).toMatchObject({ coverage: "FOUND", inspected: true, url: "https://merchant.example/privacy-policy" });
    expect(coverage.find((item) => item.type === "TERMS")).toMatchObject({ coverage: "NEEDS_REVIEW", inspected: false, url: "https://merchant.example/terms" });
    expect(coverage.find((item) => item.type === "REFUND")).toMatchObject({ coverage: "MISSING", inspected: false });
  });

  it("feeds a retained public age gate into the contextual age control", () => {
    const coverage = deriveAiPolicyCoverage([{ toolName: "dismiss_public_access_gate", kind: "VISUAL_REGION", sourceUrl: "https://merchant.example/", exactText: "Age verification 21+ Agree", metadata: {} }], false);
    expect(coverage.find((item) => item.type === "AGE")).toMatchObject({ coverage: "FOUND", inspected: true, url: "https://merchant.example/" });
  });

  it("treats retained direct footer contact methods as contact coverage", () => {
    const coverage = deriveAiPolicyCoverage([{ toolName: "inspect_footer", kind: "VISUAL_REGION", sourceUrl: "https://merchant.example/", exactText: "Support: compliance@merchant.example", surroundingDom: { controls: [{ destination: "mailto:compliance@merchant.example" }] }, metadata: {} }], true);
    expect(coverage.find((item) => item.type === "CONTACT")).toMatchObject({ coverage: "FOUND", inspected: true, url: "https://merchant.example/" });
  });
});
