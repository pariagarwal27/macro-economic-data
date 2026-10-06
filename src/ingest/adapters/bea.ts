import { fetchBeaNipa } from "../bea";

type BeaReleaseResult = {
  periodDate: string;
  value: number;
  rawValue: string;
  releasedAt: string;
};

/**
 * BEA live-release source IDs use:
 *
 *   TABLE:LINE
 *
 * Examples:
 *
 *   T20804:1   = headline PCE price index
 *   T20804:25  = core PCE price index
 *   T20807:25  = core PCE month-over-month %
 *
 * The BEA API is the live source.
 */
function parseBeaSourceId(sourceId: string) {
  const match = sourceId.match(/^([^:]+):(\d+)$/);

  if (!match) {
    throw new Error(
      `Invalid BEA sourceId "${sourceId}". Expected TABLE:LINE.`
    );
  }

  return {
    table: match[1],
    line: match[2],
  };
}

export async function fetchBeaLatest(
  metricId: string,
  sourceId: string,
  signal?: AbortSignal
): Promise<BeaReleaseResult | null> {
  if (!process.env.BEA_API_KEY) {
    throw new Error("BEA_API_KEY is not configured");
  }

  const { table, line } = parseBeaSourceId(sourceId);

  /*
   * Fetch current + previous year.
   *
   * This is enough for a monthly release worker because
   * the newly released observation will be in the current
   * calendar year.
   */
  const currentYear = new Date().getUTCFullYear();

  const points = await fetchBeaNipa(
    table,
    line,
    {
      frequency: "M",
      year: `${currentYear - 1},${currentYear}`,
    }
  );

  if (points.length === 0) {
    return null;
  }

  const latest = points[points.length - 1];

  if (!latest || !Number.isFinite(latest.value)) {
    return null;
  }

  return {
    periodDate: latest.date,
    value: Number(latest.value),
    rawValue: String(latest.value),
    releasedAt: new Date().toISOString(),
  };
}