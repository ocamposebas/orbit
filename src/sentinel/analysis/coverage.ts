export type CoverageState = "OBSERVED" | "NOT_OBSERVED" | "UNKNOWN" | "NOT_APPLICABLE";

export interface SurfaceCoverage {
  state: CoverageState;
  percent: number | null;
  inspected: number;
  expected: number;
}

export function surfaceCoverage(input: { inspected: number; expected: number; applicable?: boolean; known?: boolean }): SurfaceCoverage {
  const inspected = Math.max(0, input.inspected);
  const expected = Math.max(0, input.expected);
  if (input.known === false) return { state: "UNKNOWN", percent: null, inspected, expected };
  if (input.applicable === false) return { state: "NOT_APPLICABLE", percent: null, inspected, expected };
  if (inspected === 0) return { state: "NOT_OBSERVED", percent: 0, inspected, expected };
  return { state: "OBSERVED", percent: Math.min(100, Math.round((inspected / Math.max(expected, inspected, 1)) * 100)), inspected, expected };
}

export function coverageForAssessment(surface: SurfaceCoverage, notApplicableFallback = 100) {
  if (surface.state === "NOT_APPLICABLE") return notApplicableFallback;
  return surface.percent ?? 0;
}

export function weightedCoverage(entries: Array<{ weight: number; coverage: SurfaceCoverage }>) {
  const applicable = entries.filter((entry) => entry.coverage.state !== "NOT_APPLICABLE");
  const totalWeight = applicable.reduce((sum, entry) => sum + entry.weight, 0);
  if (!totalWeight) return 0;
  return Math.round(applicable.reduce((sum, entry) => sum + entry.weight * (entry.coverage.percent ?? 0), 0) / totalWeight);
}
