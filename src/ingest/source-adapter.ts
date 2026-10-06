import { getCloudSourceConfig, getSourceConfig } from "./source-registry";
import { getD1Database } from "@/db";
import { fetchLsegLatest } from "./adapters/lseg";
import { fetchPhiladelphiaLatest } from "./philadelphia";
import { fetchOfficialLatestFromPipeline } from "./pipeline";

export async function fetchMetricFromOfficialSource(
  metricId: string,
  signal?: AbortSignal
) {
  const config = getD1Database() ? getCloudSourceConfig(metricId) : getSourceConfig(metricId);
  if (!config) throw new Error(`No source registry entry for ${metricId}`);

  switch (config.adapter) {
    case "lseg":
      return fetchLsegLatest(config.sourceId, signal);
    case "philadelphia":
      return fetchPhiladelphiaLatest(config.sourceId, signal);
    case "pipeline":
      return fetchOfficialLatestFromPipeline(metricId);
    default:
      throw new Error(`Unsupported adapter ${config.adapter} for ${metricId}`);
  }
}
