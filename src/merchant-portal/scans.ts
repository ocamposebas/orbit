import { getDatabase } from "@/sentinel/db";

export async function getPortalScans(merchantId: string) {
  const scans = await getDatabase().aiScan.findMany({
    where: { merchantId },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true, status: true, score: true, summary: true, createdAt: true, startedAt: true, completedAt: true, updatedAt: true,
      runtimeMs: true, toolCalls: true, coverage: true, importedReportUploadedAt: true,
      site: { select: { hostname: true, normalizedUrl: true } },
      findings: { select: { severity: true, status: true } },
      _count: { select: { evidence: true, products: true } },
    },
  });
  return scans.map((scan) => ({
    ...scan,
    findingsBySeverity: scan.findings.reduce<Record<string, number>>((counts, finding) => {
      if (finding.status !== "RESOLVED") counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
      return counts;
    }, {}),
    openFindings: scan.findings.filter((finding) => finding.status !== "RESOLVED").length,
  }));
}

export async function getPortalScan(merchantId: string, scanId: string) {
  return getDatabase().aiScan.findFirst({
    where: { id: scanId, merchantId },
    include: {
      site: { select: { hostname: true, normalizedUrl: true } },
      findings: {
        orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
        include: { evidence: { include: { evidence: { select: { id: true, kind: true, sourceUrl: true, exactText: true, capturedAt: true } } } } },
      },
      products: { orderBy: { createdAt: "asc" } },
      evidence: { where: { validated: true }, orderBy: { capturedAt: "asc" }, select: { id: true, kind: true, sourceUrl: true, exactText: true, capturedAt: true } },
    },
  });
}
