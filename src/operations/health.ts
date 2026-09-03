import { getDatabase } from "@/sentinel/db";

export type MerchantHealth = {
  merchantId: string;
  merchantName: string;
  score: number;
  level: "healthy" | "attention" | "critical";
  components: Array<{ label: string; score: number; maximum: number; status: string }>;
  actions: string[];
};

export async function getMerchantHealth(merchantIds: string[]) {
  if (!merchantIds.length) return [] as MerchantHealth[];
  const since = new Date(Date.now() - 30 * 86_400_000);
  const db = getDatabase();
  const [merchants, paymentGroups] = await Promise.all([
    db.merchant.findMany({ where: { id: { in: merchantIds } }, orderBy: { businessName: "asc" }, select: {
      id: true, businessName: true, stripeConnect: { select: { displayStatus: true, cardPaymentsStatus: true, payoutsStatus: true, lastSyncedAt: true } },
      wooCommerceRelay: { select: { connectionStatus: true, lastSuccessfulRequestAt: true } },
      wooCommerceInstallations: { where: { enabled: true, revokedAt: null }, select: { id: true } },
      ecwidPaymentSessions: { take: 1, select: { id: true } },
      statements: { orderBy: { periodStart: "desc" }, take: 1, select: { status: true, emailStatus: true, periodStart: true } },
      healthScores: { orderBy: { createdAt: "desc" }, take: 1, select: { total: true, createdAt: true } },
      alerts: { where: { status: "OPEN" }, select: { id: true } },
      sites: { where: { active: true }, select: { lastScannedAt: true } },
    } }),
    db.paymentTransaction.groupBy({ by: ["merchantId", "status"], where: { merchantId: { in: merchantIds }, createdAt: { gte: since } }, _count: { _all: true } }),
  ]);
  return merchants.map((merchant): MerchantHealth => {
    const actions: string[] = [];
    const stripeEnabled = merchant.stripeConnect?.displayStatus === "ENABLED";
    const cardEnabled = /active|enabled/i.test(merchant.stripeConnect?.cardPaymentsStatus ?? "");
    const payoutsEnabled = /active|enabled/i.test(merchant.stripeConnect?.payoutsStatus ?? "");
    const financialScore = stripeEnabled && cardEnabled && payoutsEnabled ? 30 : stripeEnabled && cardEnabled ? 24 : merchant.stripeConnect ? 12 : 0;
    if (financialScore < 30) actions.push("Complete or review the Stripe Connect financial setup.");

    const groups = paymentGroups.filter((group) => group.merchantId === merchant.id);
    const total = groups.reduce((sum, group) => sum + group._count._all, 0);
    const failed = groups.filter((group) => ["FAILED", "CANCELED"].includes(group.status)).reduce((sum, group) => sum + group._count._all, 0);
    const failureRate = total ? failed / total : 0;
    const paymentScore = !total ? 14 : failureRate <= 0.05 ? 20 : failureRate <= 0.15 ? 14 : 7;
    if (failureRate > 0.15) actions.push("Review the elevated payment failure rate from the last 30 days.");

    const latestStatement = merchant.statements[0];
    const reportingScore = latestStatement?.status === "FINALIZED" && latestStatement.emailStatus === "SENT" ? 15 : latestStatement?.status === "FINALIZED" ? 11 : latestStatement ? 5 : 9;
    if (latestStatement && latestStatement.status !== "FINALIZED") actions.push("Resolve the latest statement generation or reconciliation issue.");
    else if (latestStatement && latestStatement.emailStatus === "FAILED") actions.push("Retry the failed monthly statement delivery.");

    const commerceConnected = merchant.wooCommerceRelay?.connectionStatus === "CONNECTED" || merchant.wooCommerceInstallations.length > 0 || merchant.ecwidPaymentSessions.length > 0;
    const commerceScore = commerceConnected ? 15 : merchant.wooCommerceRelay ? 9 : 6;
    if (!commerceConnected) actions.push("Verify the commerce platform connection and its latest heartbeat.");

    const complianceTotal = merchant.healthScores[0]?.total;
    const complianceScore = complianceTotal === undefined ? 10 : Math.max(0, Math.min(20, Math.round(complianceTotal / 5)));
    if ((complianceTotal ?? 100) < 80) actions.push("Address open AI Scanner findings to improve compliance health.");
    if (merchant.alerts.length) actions.push(`Resolve ${merchant.alerts.length} open compliance alert${merchant.alerts.length === 1 ? "" : "s"}.`);
    const score = Math.max(0, financialScore + paymentScore + reportingScore + commerceScore + complianceScore - Math.min(10, merchant.alerts.length * 2));
    return { merchantId: merchant.id, merchantName: merchant.businessName, score, level: score >= 80 ? "healthy" : score >= 55 ? "attention" : "critical", components: [
      { label: "Financial connection", score: financialScore, maximum: 30, status: stripeEnabled ? "Connected" : merchant.stripeConnect?.displayStatus.replaceAll("_", " ") ?? "Not connected" },
      { label: "Payment performance", score: paymentScore, maximum: 20, status: total ? `${Math.round(failureRate * 100)}% failed · ${total} attempts` : "No recent activity" },
      { label: "Statements", score: reportingScore, maximum: 15, status: latestStatement ? `${latestStatement.status} · ${latestStatement.emailStatus}` : "Waiting for first period" },
      { label: "Commerce integration", score: commerceScore, maximum: 15, status: commerceConnected ? "Connected" : "Needs verification" },
      { label: "Compliance", score: complianceScore, maximum: 20, status: complianceTotal === undefined ? "No score yet" : `${complianceTotal}/100 scanner score` },
    ], actions: [...new Set(actions)].slice(0, 5) };
  });
}
