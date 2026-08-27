import { describe, expect, it } from "vitest";
import { investigationCoverageGaps } from "@/ai-scanner/completeness";
import type { AuditCoverage } from "@/ai-scanner/types";

function coverage(overrides: Partial<AuditCoverage> = {}): AuditCoverage {
  return {
    urlsDiscovered: ["https://merchant.example/"],
    firstPartyUrlsDiscovered: ["https://merchant.example/"],
    firstPartyUrlsRemaining: [],
    siteInventoryInspected: true,
    pagesOpened: ["https://merchant.example/"],
    pagesVisuallyReviewed: ["https://merchant.example/"],
    visualRegionsInspected: 1,
    imagesInspected: 0,
    categoriesInspected: [],
    productsDiscovered: 0,
    productsVerified: 0,
    productPagesWithImagesInspected: [],
    documentsInspected: [],
    policyPagesInspected: ["TERMS", "PRIVACY", "REFUND", "SHIPPING", "CONTACT"].map((type) => ({ type: type as "TERMS" | "PRIVACY" | "REFUND" | "SHIPPING" | "CONTACT", url: `https://merchant.example/${type.toLowerCase()}` })),
    publicAccessGatesDismissed: [],
    commerceSignalsObserved: false,
    checkoutStatesInspected: [],
    checkoutFormsInspected: 0,
    totalLunaToolCalls: 8,
    auditRuntimeMs: 1_000,
    tokenUsage: { responseCalls: 1, inputTokens: 1, outputTokens: 1, cachedTokens: 0, totalTokens: 2, approximateCostUsd: 0 },
    ...overrides,
  };
}

describe("AI Scanner strict completion gate", () => {
  it("does not certify a commerce scan that stopped at an access gate or omitted products, images, and checkout", () => {
    const gaps = investigationCoverageGaps(coverage({
      policyPagesInspected: [],
      commerceSignalsObserved: true,
      firstPartyUrlsRemaining: ["https://merchant.example/products/a"],
    }), 1);
    expect(gaps).toEqual(expect.arrayContaining([
      "terms policy page not opened and inspected",
      "1 discovered first-party page not yet opened",
      "a verified product page",
      "actual product/merchandising image pixels",
      "a public cart/checkout state",
      "a checkout form with labeled controls",
    ]));
  });

  it("certifies only when every mandatory commerce surface is covered", () => {
    expect(investigationCoverageGaps(coverage({
      commerceSignalsObserved: true,
      categoriesInspected: ["https://merchant.example/catalog"],
      productsDiscovered: 2,
      productsVerified: 2,
      productPagesWithImagesInspected: ["https://merchant.example/products/a", "https://merchant.example/products/b"],
      imagesInspected: 4,
      checkoutStatesInspected: ["https://merchant.example/checkout"],
      checkoutFormsInspected: 1,
    }), 2)).toEqual([]);
  });
});
