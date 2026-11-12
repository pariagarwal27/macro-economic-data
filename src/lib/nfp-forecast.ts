export type NfpForecastCandidate = {
  releasedAt: string;
  forecast: number | null;
  importedAt?: string | null;
};

export type UpcomingNfpForecast = {
  releasedAt: string;
  value: number;
};

export type NfpPublishedRelease = {
  periodDate: string;
  value: number;
  expectedValue?: number | null;
};

export function matchNfpReleaseToObservation(
  observationDate: string | null | undefined,
  releases: readonly NfpPublishedRelease[],
) {
  if (!observationDate) return null;
  const period = observationDate.slice(0, 10);
  const release = releases.find(candidate => candidate.periodDate.slice(0, 10) === period);
  if (!release) return null;

  const forecast = release.expectedValue ?? null;
  return {
    actual: release.value,
    forecast,
    difference: forecast == null ? null : Number((release.value - forecast).toFixed(4)),
  };
}

export function forecastForNfpReleaseDate(
  releasedAt: string,
  candidates: readonly NfpForecastCandidate[],
): number | null {
  const releaseDay = releasedAt.slice(0, 10);
  const candidate = candidates
    .filter(item => item.releasedAt.slice(0, 10) === releaseDay
      && item.forecast != null
      && Number.isFinite(item.forecast))
    .sort((left, right) => Date.parse(right.importedAt ?? "") - Date.parse(left.importedAt ?? ""))[0];

  return candidate?.forecast == null ? null : Number((candidate.forecast / 1_000).toFixed(3));
}

/** Converts the next scheduled Investing NFP consensus from jobs to thousands. */
export function selectUpcomingNfpForecast(
  candidates: readonly NfpForecastCandidate[],
  now = new Date(),
): UpcomingNfpForecast | null {
  const nowTime = now.getTime();
  const upcoming = candidates
    .filter((candidate) => {
      const releaseTime = Date.parse(candidate.releasedAt);
      return Number.isFinite(releaseTime)
        && releaseTime >= nowTime
        && candidate.forecast != null
        && Number.isFinite(candidate.forecast);
    })
    .sort((left, right) => Date.parse(left.releasedAt) - Date.parse(right.releasedAt))[0];

  if (!upcoming || upcoming.forecast == null) return null;

  return {
    releasedAt: upcoming.releasedAt,
    value: Number((upcoming.forecast / 1_000).toFixed(3)),
  };
}
