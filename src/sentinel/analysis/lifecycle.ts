export function findingsToResolve<T extends { id: string; fingerprint: string }>(active: T[], observedFingerprints: ReadonlySet<string>) {
  return active.filter((finding) => !observedFingerprints.has(finding.fingerprint));
}
