import { getSourceConfig } from "./source-registry";
import { fetchLsegLatest } from "./adapters/lseg";
import { fetchPhiladelphiaLatest } from "./philadelphia";
import { fetchOfficialLatestFromPipeline } from "./pipeline";
import { fetchIsmEmploymentIndex } from "./ism-employment";
import { withFreshReleaseFetch } from "./release-fetch-context.js";

type OfficialReleaseResult = {
  periodDate: string;
  value: number;
  rawValue?: string | number | null;
  releasedAt?: string;
  releaseStage?: string;
  note?: string | null;
  history?: Array<{ date: string; value: number }>;
};

export async function fetchMetricFromOfficialSource(
  metricId: string,
  signal?: AbortSignal
): Promise<OfficialReleaseResult | null> {
  return withFreshReleaseFetch(() => fetchMetricFromOfficialSourceUncached(metricId, signal));
}

async function fetchMetricFromOfficialSourceUncached(
  metricId: string,
  signal?: AbortSignal
): Promise<OfficialReleaseResult | null> {
  const config = getSourceConfig(metricId);
  if (!config) throw new Error(`No source registry entry for ${metricId}`);

  let result: OfficialReleaseResult | null;
  switch (config.adapter) {
    case "lseg":
      result = await fetchLsegLatest(config.sourceId, signal);
      break;
    case "philadelphia":
      result = await fetchPhiladelphiaLatest(config.sourceId, signal);
      break;
    case "ism":
      result = await fetchIsmEmploymentIndex(config.sourceId as "manufacturing" | "services", signal);
      break;
    case "pipeline":
      result = await fetchOfficialLatestFromPipeline(metricId);
      break;
    default:
      throw new Error(`Unsupported adapter ${config.adapter} for ${metricId}`);
  }
  return result ? { ...result, releasedAt: result.releasedAt } : null;
}
