import type { AuditCoverage, PolicySurfaceType } from "./types";

export const REQUIRED_POLICY_SURFACES: readonly PolicySurfaceType[] = ["TERMS", "PRIVACY", "REFUND", "SHIPPING", "CONTACT"];

export function investigationCoverageGaps(coverage: AuditCoverage, observationCount?: number) {
  const inspectedPolicies = new Set(coverage.policyPagesInspected?.map((policy) => policy.type) ?? []);
  const commerce = coverage.commerceSignalsObserved
    || coverage.categoriesInspected.length > 0
    || coverage.productsDiscovered > 0
    || coverage.productsVerified > 0;
  const gaps: string[] = [];

  if (coverage.pagesOpened.length === 0) gaps.push("an opened first-party page");
  if (!coverage.siteInventoryInspected) gaps.push("robots/sitemap and rendered-link site inventory");
  if (coverage.pagesVisuallyReviewed.length === 0) gaps.push("rendered-pixel evidence");
  if (coverage.visualRegionsInspected === 0) gaps.push("a retained visual region");
  if (coverage.firstPartyUrlsRemaining?.length) gaps.push(`${coverage.firstPartyUrlsRemaining.length} discovered first-party page${coverage.firstPartyUrlsRemaining.length === 1 ? "" : "s"} not yet opened`);

  for (const type of REQUIRED_POLICY_SURFACES) {
    if (!inspectedPolicies.has(type)) gaps.push(`${type.toLowerCase().replaceAll("_", " ")} policy page not opened and inspected`);
  }
  const requiredPolicyUrls = coverage.policyPagesInspected?.filter((policy) => REQUIRED_POLICY_SURFACES.includes(policy.type)).map((policy) => policy.url) ?? [];
  if (requiredPolicyUrls.length >= REQUIRED_POLICY_SURFACES.length && new Set(requiredPolicyUrls).size < REQUIRED_POLICY_SURFACES.length) gaps.push("five distinct required policy pages");

  if (commerce) {
    if (coverage.categoriesInspected.length === 0) gaps.push("a catalog/category surface");
    if (coverage.productsVerified === 0) gaps.push("a verified product page");
    if (coverage.productsDiscovered > coverage.productsVerified) gaps.push(`${coverage.productsDiscovered - coverage.productsVerified} discovered product${coverage.productsDiscovered - coverage.productsVerified === 1 ? "" : "s"} not verified`);
    if (coverage.imagesInspected === 0) gaps.push("actual product/merchandising image pixels");
    if ((coverage.productPagesWithImagesInspected?.length ?? 0) < coverage.productsVerified) gaps.push(`${coverage.productsVerified - (coverage.productPagesWithImagesInspected?.length ?? 0)} verified product page${coverage.productsVerified - (coverage.productPagesWithImagesInspected?.length ?? 0) === 1 ? "" : "s"} without individual image inspection`);
    if (coverage.checkoutStatesInspected.length === 0) gaps.push("a public cart/checkout state");
    if ((coverage.checkoutFormsInspected ?? 0) === 0) gaps.push("a checkout form with labeled controls");
  }

  if (observationCount !== undefined && observationCount === 0) gaps.push("an evidence-backed audit observation");
  if (coverage.totalLunaToolCalls < 3) gaps.push(`${3 - coverage.totalLunaToolCalls} additional substantive tool call${3 - coverage.totalLunaToolCalls === 1 ? "" : "s"}`);
  return [...new Set(gaps)];
}
