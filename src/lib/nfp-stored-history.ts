import type { NfpModelRelease } from "./nfp-live-model";

/** Use backfilled observations only where no release exists for that period. */
export function mergeNfpStoredHistory(
  releases: NfpModelRelease[], observations: NfpModelRelease[], asOf: string,
): NfpModelRelease[] {
  const keys = new Set(releases.map(row => `${row.metricId}:${row.periodDate}`));
  const cutoff = Date.parse(asOf);
  const fallback = observations.filter(row => {
    const key = `${row.metricId}:${row.periodDate}`;
    if (keys.has(key) || !Number.isFinite(Date.parse(row.releasedAt)) || Date.parse(row.releasedAt) > cutoff) return false;
    keys.add(key);
    return true;
  });
  return [...releases, ...fallback];
}
