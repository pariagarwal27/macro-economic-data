import { METRICS } from "@/catalog/metrics";
import { LIVE_MAP } from "@/catalog/live-map";
import { UK_RETAIL_RELEASE_IDS } from "@/lib/uk-retail";
import { PCE_EXPENDITURE_LINES } from "@/lib/pce-expenditure";
import { EA_MARKET_METRIC_IDS } from "./ea-market-refresh";

export type AdapterName =
  | "lseg"
  | "pipeline"
  | "philadelphia"
  | "ism";

export type MetricSourceConfig = {
  metricId: string;
  adapter: AdapterName;
  source: string;
  sourceId: string;
  releaseStrategy: "scheduled-poll" | "release-day-poll";
  pollSeconds: number;
  notes?: string;
};

// These LSEG series are not displayed on the main dashboard, so do not arm
// background release polling for them. Their catalog metadata and stored
// history remain available for references and existing data.
const EXCLUDED_FROM_DASHBOARD_RELEASE_POLLING = new Set([
  "us-cfnai",
  "us-dallas-fed-activity",
  "us-building-permits",
  "us-durable-goods",
  "us-housing-starts",
  "ea-esi",
  "us-gdp-now",
]);

// Authoritative LSEG routes supplied for the project. The 15 PCE-family
// routes are deliberately excluded from this array and are routed to BEA.
// PMI series use LSEG Economic Indicators in the local runtime.
const OFFICIAL_US_LABOR_METRICS = new Set(METRICS.filter(metric =>
  metric.id.startsWith("us-jolts-") || ["us-unemployment", "us-ahe", "us-ahe-mom"].includes(metric.id)
).map(metric => metric.id));

const OFFICIAL_UK_ONS_METRICS = new Set([
  "uk-vacancies", "uk-unemployment", "uk-payrolled-employees-level",
  "uk-payrolled-employees-annual-change", "uk-cpi-yoy", "uk-cpi-mom",
  "uk-core-cpi-yoy", "uk-core-cpi-mom", "uk-services-cpi-yoy", "uk-services-cpi-mom",
]);

const LSEG: MetricSourceConfig[] = [
  ["us-ism-manufacturing-pmi","USPMI=ECI"],["us-ism-services-pmi","USNPMI=ECI"],
  ["us-sp-global-manufacturing-pmi","USMPMF=ECI"],["us-sp-global-services-pmi","USMPSF=ECI"],
  ["uk-sp-global-manufacturing-pmi","GBPMIM=ECI"],["uk-sp-global-services-pmi","GBPMIS=ECI"],
  ["uk-sp-global-composite-pmi","GBCPMI=ECI"],
  ["ea-sp-global-manufacturing-pmi","EUPMI=ECI"],["ea-sp-global-services-pmi","EUPMIS=ECI"],
  ["ea-sp-global-composite-pmi","EUPMIP=ECI"],
  ["us-cpi","USCPN=ECI"],["us-cpi-yoy","USCPNY=ECI"],["us-cpi-mom","USCPI=ECI"],
  ["us-cpi-core","USCPNX=ECI"],["us-core-cpi-mom","USCPF=ECI"],["us-core-cpi-yoy","USCPFY=ECI"],
  ["us-cpi-nsa","USCPN=ECI"],
  ["us-core-goods-cpi-yoy","USCPOY=ECI"],["us-core-goods-cpi-mom","USCPOF=ECI"],
  ["us-services-cpi-yoy","USCPS=ECI"],["us-services-cpi-mom","USCPSM=ECI"],
  ["us-cpi-food","USCPFOD=ECI"],["us-cpi-energy","USCPNRG=ECI"],["us-cpi-apparel","aUSCPICL/A"],
  ["us-cpi-other-goods","aUSCPOF/C"],["us-cpi-shelter","USCPSHL=ECI"],
  ["us-cpi-medical-services","aUSCWSMF/C"],["us-cpi-transport-services","aUSCWSTF/C"],
  ["us-umich-sentiment","USUMSF=ECI"],
  ["us-manufacturers-new-orders","USDGN=ECI"],["us-eci-wages","USECIW=ECI"],
  ["us-eci-total","USECI=ECI"],["us-ahe","USAHEY=ECI"],["us-ahe-mom","USAHE=ECI"],
  ["us-gdp-now","aUSGHCG/A"],["us-industrial-production","USIP=ECI"],
  ["us-capacity-utilization","USCAPU=ECI"],["us-retail-sales-ex-auto","USRSLA=ECI"],
  ["us-durable-goods","USDUR=ECI"],["us-housing-starts","USHST=ECI"],
  ["us-building-permits","USBP=ECI"],["us-empire-state","USEMP=ECI"],
  ["us-dallas-fed-activity","USDFED=ECI"],["us-cfnai","USCFNA=ECI"],
  ["us-personal-spending","USPSPD=ECI"],["us-nfp","USNFAR=ECI"],
  ["us-unemployment","USUNR=ECI"],["us-u6","USUDEP=ECI"],["us-employment-population","USEMPO=ECI"],
  ["us-jolts-openings","USJOLT=ECI"],["us-jolts-quits","USJQU=ECI"],
  ["us-jolts-hires","USJHI=ECI"],["us-jolts-layoffs","USJLA=ECI"],
  ["us-temp-help","aUSNFTHS/A"],["us-avg-workweek","USAHW=ECI"],
  ["us-unemployed-persons","aUS3B010"],["us-long-term-unemployed","pUSRECOAP=O"],
  ["us-private-payrolls","USPRP=ECI"],["us-government-payrolls","USGOV=ECI"],
  ["us-civilian-labor-force","USLBFB=ECI"],["us-jolts-hires-level","aUSJBHIREO/A"],
  ["us-jolts-quits-level","aUSJBQUITO/A"],["us-jolts-layoffs-level","aUSJBLOFFP"],
  ["us-jolts-total-separations","aUSJBSEPRO/A"],["us-average-weekly-earnings","USEARN=ECI"],
  ["us-retail-gasoline","USRLCO=ECI"],["us-retail-food-beverage","aUSRSLSFB/A"],
  ["us-retail-general-merchandise","aUSRSLSGM/A"],["us-retail-nonstore","aUSRSLSNSR/A"],
  ["us-retail-food-services","USRSL=ECI"],["us-retail-total-ex-auto-gas","aUSRSLGA"],
  // UK
  ["uk-cpi-yoy","GBHICY=ECI"],["uk-alcohol-cpi-yoy","GBCPXY=ECI"],["uk-cpi-mom","GBHICM=ECI"],
  ["uk-core-cpi-mom","GBCPXM=ECI"],["uk-services-cpi-yoy","pGBCPXY=4295870355"],
  ["uk-housing-cpi-yoy","GBNHP=ECI"],
  ["uk-gdp-yoy","GBGDPY=ECI"],
  ["uk-industrial-production","GBIPY=ECI"],
  ["uk-retail-sales","GBRSLY=ECI"],["uk-cli","aGBCLEAD"],["uk-business-confidence","aGBEUSRCIR"],
  ["uk-unemployment","GBUNR=ECI"],["uk-vacancies","GBVAC=ECI"],
  ["uk-payrolled-employees-level","GBPYR=ECI"],["uk-employment-change","GBEMP=ECI"],
  ["uk-retail-sales-mom","GBRSL=ECI"],
  ["uk-retail-food-stores","aGBRSLSVFS/CA"],
  ["uk-retail-automotive-fuel","GBRSX=ECI"],
  ["uk-employment-rate","GBILOU=ECI"],["uk-inactivity-rate","aGBEIAPRT/A"],
  // Euro area national HICP metrics use the official Eurostat API mapping in
  // LIVE_MAP. Do not route them through the optional LSEG desktop worker.
  ["ea-industrial-production","EUIPY=ECI"],["ea-retail-sales","EURSLY=ECI"],
  // Euro-area unemployment uses the official Eurostat une_rt_m mapping.
  ["ea-esi","EUCONS=ECI"],["de-unemployment","DEUNR=ECI"],
  // Euro area employment uses the official Eurostat LFS employment series.
  ["ea-retail-sales-mom","EURSL=ECI"],
].filter(([metricId]) => !OFFICIAL_US_LABOR_METRICS.has(metricId) && !OFFICIAL_UK_ONS_METRICS.has(metricId)).map(([metricId, sourceId]) => ({
  metricId, source: "LSEG", sourceId, adapter: "lseg",
  releaseStrategy: "scheduled-poll", pollSeconds: 5
}));

const PCE_FAMILY = new Set([
  "us-pce", "us-core-pce", "us-pce-yoy", "us-pce-mom", "us-core-pce-yoy", "us-pce-goods", "us-pce-durable-goods",
  "us-pce-motor-vehicles", "us-pce-recreational-goods", "us-pce-other-durable-goods", "us-pce-other-nondurable-goods",
  "us-pce-furnishings", "us-pce-clothing", "us-pce-food", "us-pce-energy",
  "us-pce-services", "us-pce-household-services", "us-pce-healthcare",
  "us-pce-transport-services", "us-pce-recreation-services", "us-pce-food-services", "us-pce-financial-services", "us-pce-other-services", "us-pce-housing", "us-pce-housing-utilities", "us-core-pce-mom", "us-core-pce-ex-housing",
  "us-real-pce-growth", "us-real-pce-goods", "us-real-pce-durable-goods",
  "us-real-pce-nondurable-goods", "us-real-pce-services",
  ...Object.keys(PCE_EXPENDITURE_LINES),
]);

// Route the entire catalogued US consumer-price index family through its
// official BLS series. LSEG remains available for other metrics but must not
// shadow BLS revisions or component history here.

const CLEVELAND_EXPECTATION_METRICS = new Set([
  "us-cleveland-exp-inf-1y",
  "us-cleveland-exp-inf-2y",
  "us-cleveland-exp-inf-3y",
  "us-cleveland-exp-inf-5y",
  "us-cleveland-exp-inf-10y",
  "us-cleveland-exp-inf-30y",
]);

const ATLANTA_BIE_METRICS = new Set([
  "us-atlanta-bie-1y",
  "us-atlanta-bie-unit-cost-1y",
]);

const CATALOG_FALLBACK: MetricSourceConfig[] = METRICS
  .filter((m) => !PCE_FAMILY.has(m.id))
  .filter((m) => m.source !== "ism")
  .filter((m) => !isUsCpiLsegOnlyMetric(m.id))
  .filter((m) => !LSEG.some((x) => x.metricId === m.id))
  .filter((m) => !["us-umich-inflation-exp-1y", "us-umich-inflation-exp-5y"].includes(m.id))
  .map((m) => ({
    metricId: m.id,
    adapter: m.source === "philadelphia" ? "philadelphia" : "pipeline",
    source: OFFICIAL_UK_ONS_METRICS.has(m.id) ? "ons" : OFFICIAL_US_LABOR_METRICS.has(m.id) ? "bls" : CLEVELAND_EXPECTATION_METRICS.has(m.id) ? "cleveland" : m.source,
    sourceId: OFFICIAL_US_LABOR_METRICS.has(m.id) || OFFICIAL_UK_ONS_METRICS.has(m.id) ? (LIVE_MAP[m.id]?.seriesId ?? m.seriesId) : m.seriesId,
    releaseStrategy: "release-day-poll",
    pollSeconds: m.id.startsWith('us-ppi-') ? 60 : m.source === "fred" ? 30 : 15,
  }));

const PCE_BEA: MetricSourceConfig[] = METRICS
  .filter((m) => PCE_FAMILY.has(m.id))
  .map((m) => ({
    metricId: m.id,
    adapter: "pipeline",
    source: "bea",
    sourceId: m.seriesId,
    releaseStrategy: "release-day-poll",
    pollSeconds: 10,
    notes: "PCE family explicitly routed to BEA; LSEG excluded by project decision.",
  }));

const UMICH_EXPECTATIONS: MetricSourceConfig[] = [
  ["us-umich-inflation-exp-1y", "PX1"],
  ["us-umich-inflation-exp-5y", "PX5"],
].map(([metricId, sourceId]) => ({
  metricId,
  adapter: "pipeline",
  source: "umich",
  sourceId,
  releaseStrategy: "release-day-poll",
  pollSeconds: 15,
  notes: "Official University of Michigan Surveys of Consumers source",
}));

const ISM_EMPLOYMENT: MetricSourceConfig[] = [
  ["us-ism-manufacturing-employment", "manufacturing"],
  ["us-ism-services-employment", "services"],
].map(([metricId, sourceId]) => ({
  metricId,
  adapter: "ism",
  source: "ism",
  sourceId,
  releaseStrategy: "release-day-poll",
  pollSeconds: 30,
  notes: "Official ISM PMI report employment sub-index",
}));

export const SOURCE_REGISTRY: MetricSourceConfig[] = [
  ...LSEG.filter((x) => !EXCLUDED_FROM_DASHBOARD_RELEASE_POLLING.has(x.metricId)).map((x) => ({
    ...x,
    releaseStrategy: "scheduled-poll" as const,
    pollSeconds: 5,
  })),
  ...PCE_BEA,
  ...UMICH_EXPECTATIONS,
  ...CATALOG_FALLBACK,
  ...ISM_EMPLOYMENT,
];

export const SOURCE_REGISTRY_MAP = new Map(
  SOURCE_REGISTRY.map((x) => [x.metricId, x])
);

export function getSourceConfig(metricId: string) {
  if (EXCLUDED_FROM_DASHBOARD_RELEASE_POLLING.has(metricId)) return null;
  // These chart measures are one ONS release family, including the legacy
  // headline MoM alias that otherwise routes to a separate LSEG feed.
  if (UK_RETAIL_RELEASE_IDS.includes(metricId)) {
    const metric = METRICS.find(item => item.id === metricId)!;
    return { metricId, adapter: "pipeline" as const, source: "ons", sourceId: metric.seriesId,
      releaseStrategy: "release-day-poll" as const, pollSeconds: 15 };
  }
  if (isUsCpiMetric(metricId)) {
    const metric = METRICS.find((item) => item.id === metricId);
    if (metric) return {
      metricId,
      adapter: "pipeline" as const,
      source: "bls",
      sourceId: metric.seriesId,
      releaseStrategy: "release-day-poll" as const,
      pollSeconds: 15,
      notes: "Official BLS CPI series",
    };
  }
  const config = SOURCE_REGISTRY_MAP.get(metricId) ?? null;
  if (isUsCpiLsegOnlyMetric(metricId) && config?.adapter !== "lseg") return null;
  return config;
}

/** Detect metrics belonging to the US CPI/Core CPI family. */
export function isUsCpiMetric(metricId: string) {
  const metric = METRICS.find((item) => item.id === metricId);
  return Boolean(
    metric?.region === "US" &&
      metric.category === "inflation" &&
      ["us_inflation_core", "us_inflation_support", "us_cpi_component"].includes(metric.subcategory ?? "") &&
      !PCE_FAMILY.has(metricId)
  );
}

/** Metrics explicitly assigned to official BLS CPI series. */
export function isUsCpiBlsMetric(metricId: string) {
  return isUsCpiMetric(metricId);
}

/** CPI family metrics except those explicitly assigned to BLS remain LSEG-only. */
export function isUsCpiLsegOnlyMetric(metricId: string) {
  return isUsCpiMetric(metricId) && !isUsCpiBlsMetric(metricId);
}

/** CPI backfills may return a shorter LSEG history than the database already has. */
export function shouldMergeHistoricalBackfill(metricId: string) {
  return isUsCpiLsegOnlyMetric(metricId) || EA_MARKET_METRIC_IDS.includes(metricId);
}

/**
 * Resolve the source that supplies live values in the local runtime.
 */
export function getActiveLiveSource(metricId: string): string | null {
  const config = getSourceConfig(metricId);
  if (!config) return null;
  if (config.adapter !== "pipeline") return config.source;

  const mapped = LIVE_MAP[metricId];
  return mapped && mapped.provider !== "lseg" ? mapped.provider : config.source;
}

/** Return only the live mapping active in the selected runtime. */
export function getActiveLiveMapping(metricId: string) {
  if (isUsCpiLsegOnlyMetric(metricId)) {
    const config = getSourceConfig(metricId);
    return config?.adapter === "lseg"
      ? { provider: "lseg" as const, seriesId: config.sourceId }
      : undefined;
  }
  if (isUsCpiBlsMetric(metricId)) {
    const config = getSourceConfig(metricId);
    return config?.source === "bls"
      ? { provider: "bls" as const, seriesId: config.sourceId }
      : undefined;
  }
  const umich = SOURCE_REGISTRY_MAP.get(metricId);
  if (umich?.source === "umich") return { provider: "umich" as const, seriesId: umich.sourceId };
  const mapped = LIVE_MAP[metricId];
  return mapped;
}

export function assertRegistryIsValid() {
  const catalogIds = new Set(METRICS.map((m) => m.id));
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const extras: string[] = [];
  for (const x of SOURCE_REGISTRY) {
    if (seen.has(x.metricId)) duplicates.push(x.metricId);
    seen.add(x.metricId);
    if (!catalogIds.has(x.metricId)) extras.push(x.metricId);
  }
  const missing = [...catalogIds].filter((id) => !seen.has(id) && !isUsCpiMetric(id) && !EXCLUDED_FROM_DASHBOARD_RELEASE_POLLING.has(id));
  if (duplicates.length || extras.length || missing.length) {
    throw new Error(
      `Source registry invalid. duplicates=${duplicates.join(",")} extras=${extras.join(",")} missing=${missing.join(",")}`
    );
  }
  return true;
}

assertRegistryIsValid();
