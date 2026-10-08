import { METRICS } from "@/catalog/metrics";
import { LIVE_MAP } from "@/catalog/live-map";

export type AdapterName =
  | "lseg"
  | "pipeline"
  | "philadelphia";

export type MetricSourceConfig = {
  metricId: string;
  adapter: AdapterName;
  source: string;
  sourceId: string;
  releaseStrategy: "scheduled-poll" | "release-day-poll";
  pollSeconds: number;
  notes?: string;
};

// Authoritative LSEG routes supplied for the project. The 15 PCE-family
// routes are deliberately excluded from this array and are routed to BEA.
// PMI series use the official ISM/S&P release-page fetcher instead: the LSEG
// worker requires a separate desktop session that is not present on Render.
const LSEG: MetricSourceConfig[] = [
  ["us-cpi","USCPNY=ECI"],["us-cpi-mom","USCPI=ECI"],["us-cpi-core","USCPFY=ECI"],
  ["us-core-goods-cpi-yoy","USCPOY=ECI"],["us-core-goods-cpi-mom","USCPOF=ECI"],
  ["us-services-cpi-yoy","USCPS=ECI"],["us-services-cpi-mom","USCPSM=ECI"],
  ["us-cpi-food","USCPFOD=ECI"],["us-cpi-energy","USCPNRG=ECI"],["us-cpi-apparel","aUSCPICL/A"],
  ["us-cpi-other-goods","aUSCPOF/C"],["us-cpi-shelter","USCPSHL=ECI"],
  ["us-cpi-medical-services","aUSCWSMF/C"],["us-cpi-transport-services","aUSCWSTF/C"],
  ["us-ppi-final-demand","USPPFD=ECI"],["us-ppi-core","USPPIE=ECI"],
  ["us-cleveland-median-cpi","aUSCPIM12"],["us-umich-inflation-exp-1y","USUM1P=ECI"],
  ["us-umich-sentiment","USUMSF=ECI"],["us-import-prices","USIPI=ECI"],
  ["us-manufacturers-new-orders","USDGN=ECI"],["us-eci-wages","USECIW=ECI"],
  ["us-eci-total","USECI=ECI"],["us-ahe","USAHEY=ECI"],["us-ahe-mom","USAHE=ECI"],
  ["us-gdp-now","aUSGHCG/A"],["us-industrial-production","USIP=ECI"],
  ["us-capacity-utilization","USCAPU=ECI"],["us-retail-sales-ex-auto","USRSLA=ECI"],
  ["us-durable-goods","USDUR=ECI"],["us-housing-starts","USHST=ECI"],
  ["us-building-permits","USBP=ECI"],["us-empire-state","USEMP=ECI"],
  ["us-dallas-fed-activity","USDFED=ECI"],["us-cfnai","USCFNA=ECI"],
  ["us-personal-spending","USPSPD=ECI"],["us-nfp","USNFAR=ECI"],["us-adp-change","USADPC=ECI"],
  ["us-unemployment","USUNR=ECI"],["us-u6","USUDEP=ECI"],["us-employment-population","USEMPO=ECI"],
  ["us-jolts-openings","USJOLT=ECI"],["us-jolts-quits","USJQU=ECI"],
  ["us-jolts-hires","USJHI=ECI"],["us-jolts-layoffs","USJLA=ECI"],
  ["us-temp-help","aUSNFTHS/A"],["us-avg-workweek","USAHW=ECI"],
  ["us-umich-inflation-exp-5y","USUM5P=ECI"],
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
  ["uk-housing-cpi-yoy","GBNHP=ECI"],["uk-rpi-yoy","GBRPI=ECI"],["uk-ppi-output-yoy","GBPPIY=ECI"],
  ["uk-awe-regular-yoy","GBAWEY=ECI"],["uk-ppi-input-yoy","GBPINY=ECI"],["uk-gdp-yoy","GBGDPY=ECI"],
  ["uk-industrial-production","GBIPY=ECI"],
  ["uk-retail-sales","GBRSLY=ECI"],["uk-cli","aGBCLEAD"],["uk-business-confidence","aGBEUSRCIR"],
  ["uk-unemployment","GBUNR=ECI"],["uk-awe-total-yoy","GBATOY=ECI"],["uk-vacancies","GBVAC=ECI"],
  ["uk-payrolled-employees-level","GBPYR=ECI"],["uk-employment-change","GBEMP=ECI"],
  ["uk-retail-sales-mom","GBRSL=ECI"],
  ["uk-retail-food-stores","aGBRSLSVFS/CA"],
  ["uk-retail-automotive-fuel","GBRSX=ECI"],
  ["uk-employment-rate","GBILOU=ECI"],["uk-inactivity-rate","aGBEIAPRT/A"],
  // Euro area
  ["ea-hicp-yoy","EUHICY=ECI"],["ea-core-hicp-yoy","EUCPXY=ECI"],["ea-hicp-mom","EUHIC=ECI"],
  ["de-cpi-yoy","DEHICY=ECI"],["fr-cpi-yoy","FRHICY=ECI"],["it-cpi-yoy","ITHICY=ECI"],
  ["es-cpi-yoy","ESHICY=ECI"],["ea-ppi-yoy","EUPPIY=ECI"],
  ["ea-industrial-production","EUIPY=ECI"],["ea-retail-sales","EURSLY=ECI"],
  ["ea-esi","EUCONS=ECI"],["ea-unemployment","EUUNR=ECI"],["de-unemployment","DEUNR=ECI"],
  ["ea-employment-yoy","EUEMPY=ECI"],["ea-employment-qoq","EUEMPQ=ECI"],
  ["ea-retail-sales-mom","EURSL=ECI"],
].map(([metricId, sourceId]) => ({
  metricId, source: "LSEG", sourceId, adapter: "lseg",
  releaseStrategy: "scheduled-poll", pollSeconds: 5
}));

const PCE_FAMILY = new Set([
  "us-pce", "us-core-pce", "us-pce-goods", "us-pce-durable-goods",
  "us-pce-furnishings", "us-pce-clothing", "us-pce-food", "us-pce-energy",
  "us-pce-services", "us-pce-household-services", "us-pce-healthcare",
  "us-pce-food-services", "us-pce-housing", "us-core-pce-mom",
  "us-real-pce-growth", "us-real-pce-goods", "us-real-pce-durable-goods",
  "us-real-pce-nondurable-goods", "us-real-pce-services",
]);

const CATALOG_FALLBACK: MetricSourceConfig[] = METRICS
  .filter((m) => !PCE_FAMILY.has(m.id))
  .filter((m) => !LSEG.some((x) => x.metricId === m.id))
  .map((m) => ({
    metricId: m.id,
    adapter: m.source === "philadelphia" ? "philadelphia" : "pipeline",
    source: m.source,
    sourceId: m.seriesId,
    releaseStrategy: "release-day-poll",
    pollSeconds: m.source === "fred" ? 30 : 15,
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

export const SOURCE_REGISTRY: MetricSourceConfig[] = [
  ...LSEG.map((x) => ({
    ...x,
    releaseStrategy: "scheduled-poll" as const,
    pollSeconds: 5,
  })),
  ...PCE_BEA,
  ...CATALOG_FALLBACK,
];

export const SOURCE_REGISTRY_MAP = new Map(
  SOURCE_REGISTRY.map((x) => [x.metricId, x])
);

export function getSourceConfig(metricId: string) {
  return SOURCE_REGISTRY_MAP.get(metricId) ?? null;
}

// Desktop-only routes stay intact locally. Hosted execution uses the official
// mapping already defined by this project, without silently switching to FRED.
export function getCloudSourceConfig(metricId: string): MetricSourceConfig | null {
  const metric = METRICS.find(m => m.id === metricId);
  if (!metric) return null;
  const live = LIVE_MAP[metricId];
  const source = live && live.provider !== "lseg" ? live.provider : metric.source;
  if (source === "lseg" || source === "pmi_scrape" || source === "atlanta") return null;
  if (source === "ecb" && /^EA_INFL_COMP_/.test(metric.seriesId)) return null;
  return {
    metricId, source,
    sourceId: live && live.provider !== "lseg" ? live.seriesId : metric.seriesId,
    adapter: source === "philadelphia" ? "philadelphia" : "pipeline",
    releaseStrategy: "scheduled-poll", pollSeconds: 60,
  };
}

/**
 * Resolve the source that actually supplies live values in the selected runtime.
 * Pipeline adapters honor LIVE_MAP when present; dedicated adapters (for example
 * LSEG) use their registry source directly.
 */
export function getActiveLiveSource(metricId: string, isCloud: boolean): string | null {
  const config = isCloud ? getCloudSourceConfig(metricId) : getSourceConfig(metricId);
  if (!config) return null;
  if (config.adapter !== "pipeline") return config.source;

  const mapped = LIVE_MAP[metricId];
  return mapped && mapped.provider !== "lseg" ? mapped.provider : config.source;
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
  const missing = [...catalogIds].filter((id) => !seen.has(id));
  if (duplicates.length || extras.length || missing.length) {
    throw new Error(
      `Source registry invalid. duplicates=${duplicates.join(",")} extras=${extras.join(",")} missing=${missing.join(",")}`
    );
  }
  return true;
}

assertRegistryIsValid();
