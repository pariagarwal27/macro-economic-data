/** Official weights for the retail index component field, separate from CPI basket weights. */
export type OfficialRetailIndexWeight = {
  value: number;
  year: number;
  basis: string;
  source: string;
};

export type RetailWeightAvailability = {
  label: string;
  explanation: string;
  source: string;
};

const ONS_RSI_WEIGHTS = "ONS Retail Sales Index category weights, 2025";
const ONS_RSI_SOURCE = "https://www.ons.gov.uk/businessindustryandtrade/retailindustry/datasets/retailsalesindexcategoriesandtheirpercentageweights/current";
const EUROSTAT_STS_SOURCE = "https://ec.europa.eu/eurostat/cache/metadata/en/sts_esms.htm";
const CENSUS_MRTS_SOURCE = "https://www.census.gov/retail/mrts/how_surveys_are_collected.html";

const ukWeight = (value: number): OfficialRetailIndexWeight => ({
  value,
  year: 2025,
  basis: ONS_RSI_WEIGHTS,
  source: ONS_RSI_SOURCE,
});

const ukWeights: Record<string, OfficialRetailIndexWeight> = {
  // ONS 2025 table: percentages of all retailing. Non-food stores is the sum
  // of the four published non-food store groups (7.27 + 10.78 + 6.91 + 13.22).
  "uk-retail-food-stores": ukWeight(40.16),
  "uk-retail-non-food-stores": ukWeight(38.18),
  "uk-retail-nonstore": ukWeight(13.28),
  "uk-retail-automotive-fuel": ukWeight(8.37),
  "uk-retail-sales-total-ex-fuel": ukWeight(91.63),
};

export function getOfficialRetailIndexWeight(metricId?: string): OfficialRetailIndexWeight | null {
  return metricId ? ukWeights[metricId] ?? null : null;
}

/** Explains why no numeric, directly comparable official index weight is shown. */
export function getRetailWeightAvailability(metricId?: string): RetailWeightAvailability | null {
  if (!metricId) return null;
  if (metricId.startsWith("us-retail-")) {
    return {
      label: "N/P",
      explanation: "The US Census Monthly Retail Trade Survey publishes dollar sales estimates by category and survey sample weights for firms, but not fixed category index weights.",
      source: CENSUS_MRTS_SOURCE,
    };
  }
  if (metricId.startsWith("ea-retail-")) {
    return {
      label: "Not mapped",
      explanation: "Eurostat uses 2021 turnover weights and publishes a non-confidential weights table; detailed weights can be confidential. This dashboard does not yet have a directly mapped public value for this component.",
      source: EUROSTAT_STS_SOURCE,
    };
  }
  return null;
}

export function formatOfficialRetailIndexWeight(value: number): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}%`;
}
