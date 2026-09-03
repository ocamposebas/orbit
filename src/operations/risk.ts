import { getMerchantRiskSnapshot, type PortalRiskItem } from "@/merchant-portal/data";

export async function getPortfolioRisk(merchants: Array<{ id: string; businessName: string }>) {
  const snapshots: Array<{ merchantId: string; merchantName: string; available: boolean; issue: string | null; items: PortalRiskItem[] }> = [];
  for (let index = 0; index < merchants.length; index += 4) {
    const chunk = merchants.slice(index, index + 4);
    snapshots.push(...await Promise.all(chunk.map(async (merchant) => ({ merchantId: merchant.id, merchantName: merchant.businessName, ...await getMerchantRiskSnapshot(merchant.id) }))));
  }
  const names = new Map(merchants.map((merchant) => [merchant.id, merchant.businessName]));
  const items = snapshots.flatMap((snapshot) => snapshot.items.map((item) => ({ ...item, merchantName: names.get(item.merchantId) ?? "Merchant" }))).sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  const actionable = items.filter((item) => ["needs_response", "warning_needs_response", "actionable", "open"].includes(item.status));
  const atRisk = new Map<string, number>();
  for (const item of actionable) if (item.amountMinor !== null && item.currency) atRisk.set(item.currency, (atRisk.get(item.currency) ?? 0) + item.amountMinor);
  return {
    items,
    actionable: actionable.length,
    disputes: items.filter((item) => item.kind === "dispute").length,
    reviews: items.filter((item) => item.kind === "review").length,
    warnings: items.filter((item) => item.kind === "warning").length,
    atRisk: [...atRisk].map(([currency, amountMinor]) => ({ currency, amountMinor })),
    unavailableMerchants: snapshots.filter((snapshot) => !snapshot.available).map((snapshot) => ({ merchantName: snapshot.merchantName, issue: snapshot.issue })),
  };
}
