export type OfficialComponentWeight = {
  /** Share of the all-items consumer price basket, expressed as percent. */
  value: number;
  year: 2026;
  basis: string;
  source: string;
};

const BLS_2026 = "BLS CPI-U relative importance, December 2025 weights used for 2026";
const ONS_CPI_2026 = "ONS CPI, February–December 2026 weights (ppt converted to percent)";
const ONS_CPIH_2026 = "ONS CPIH, February–December 2026 weights (ppt converted to percent)";
const EUROSTAT_2026 = "Eurostat euro-area HICP 2026 weights (‰ converted to percent)";

const BLS_URL = "https://www.bls.gov/cpi/tables/relative-importance/2025.htm";
const ONS_URL = "https://www.ons.gov.uk/economy/inflationandpriceindices/articles/consumerpriceinflationupdatingweights/2026";
const EUROSTAT_URL = "https://ec.europa.eu/eurostat/statistics-explained/SEPDF/cache/18881.pdf?v=1250650036640850";

const weight = (value: number, basis: string, source: string): OfficialComponentWeight => ({
  value,
  year: 2026,
  basis,
  source,
});

const officialWeights: Record<string, OfficialComponentWeight> = {
  // BLS CPI-U relative importance: percent of all items, December 2025
  // expenditure weights, the official weight set applied to 2026.
  "us-cpi": weight(100, BLS_2026, BLS_URL),
  "us-cpi-core": weight(79.919, BLS_2026, BLS_URL),
  "us-cpi-food": weight(13.698, BLS_2026, BLS_URL),
  "us-cpi-energy": weight(6.383, BLS_2026, BLS_URL),
  "us-cpi-shelter": weight(35.625, BLS_2026, BLS_URL),
  "us-cpi-apparel": weight(2.368, BLS_2026, BLS_URL),
  "us-cpi-new-vehicles": weight(3.838, BLS_2026, BLS_URL),
  "us-cpi-used-cars": weight(2.759, BLS_2026, BLS_URL),
  "us-cpi-medical-commodities": weight(1.489, BLS_2026, BLS_URL),
  "us-cpi-medical-services": weight(6.935, BLS_2026, BLS_URL),
  "us-cpi-recreation-commodities": weight(1.821, BLS_2026, BLS_URL),
  "us-cpi-transport-services": weight(6.315, BLS_2026, BLS_URL),

  // ONS CPI division weights: published in parts per thousand; converted to %.
  "uk-food-cpi-yoy": weight(10.9606, ONS_CPI_2026, ONS_URL),
  "uk-alcohol-cpi-yoy": weight(3.7165, ONS_CPI_2026, ONS_URL),
  "uk-clothing-cpi-yoy": weight(5.6721, ONS_CPI_2026, ONS_URL),
  "uk-housing-cpi-yoy": weight(13.1251, ONS_CPI_2026, ONS_URL),
  "uk-furniture-cpi-yoy": weight(5.3833, ONS_CPI_2026, ONS_URL),
  "uk-health-cpi-yoy": weight(2.6179, ONS_CPI_2026, ONS_URL),
  "uk-transport-cpi-yoy": weight(14.0967, ONS_CPI_2026, ONS_URL),
  "uk-communication-cpi-yoy": weight(2.4365, ONS_CPI_2026, ONS_URL),
  "uk-recreation-cpi-yoy": weight(15.2149, ONS_CPI_2026, ONS_URL),
  "uk-education-cpi-yoy": weight(3.4247, ONS_CPI_2026, ONS_URL),
  "uk-restaurants-hotels-cpi-yoy": weight(13.8628, ONS_CPI_2026, ONS_URL),
  "uk-miscellaneous-cpi-yoy": weight(9.4889, ONS_CPI_2026, ONS_URL),

  // ONS CPIH division weights, independently mapped to the CPIH series.
  "uk-food-cpih-yoy": weight(8.658, ONS_CPIH_2026, ONS_URL),
  "uk-alcohol-cpih-yoy": weight(2.9357, ONS_CPIH_2026, ONS_URL),
  "uk-clothing-cpih-yoy": weight(4.4805, ONS_CPIH_2026, ONS_URL),
  "uk-housing-cpih-yoy": weight(31.3761, ONS_CPIH_2026, ONS_URL),
  "uk-furniture-cpih-yoy": weight(4.2524, ONS_CPIH_2026, ONS_URL),
  "uk-health-cpih-yoy": weight(2.0679, ONS_CPIH_2026, ONS_URL),
  "uk-transport-cpih-yoy": weight(11.1353, ONS_CPIH_2026, ONS_URL),
  "uk-communication-cpih-yoy": weight(1.9247, ONS_CPIH_2026, ONS_URL),
  "uk-recreation-cpih-yoy": weight(12.0185, ONS_CPIH_2026, ONS_URL),
  "uk-education-cpih-yoy": weight(2.7052, ONS_CPIH_2026, ONS_URL),
  "uk-restaurants-hotels-cpih-yoy": weight(10.9504, ONS_CPIH_2026, ONS_URL),
  "uk-miscellaneous-cpih-yoy": weight(7.4954, ONS_CPIH_2026, ONS_URL),

  // Eurostat euro-area HICP 2026 published aggregates.
  "ea-hicp-yoy": weight(100, EUROSTAT_2026, EUROSTAT_URL),
  "ea-core-hicp-yoy": weight(72.038, EUROSTAT_2026, EUROSTAT_URL),
  "ea-goods-hicp-yoy": weight(25.216, EUROSTAT_2026, EUROSTAT_URL),
  "ea-services-hicp-yoy": weight(46.823, EUROSTAT_2026, EUROSTAT_URL),
  "ea-energy-hicp-yoy": weight(9.026, EUROSTAT_2026, EUROSTAT_URL),
  "ea-food-hicp-yoy": weight(18.935, EUROSTAT_2026, EUROSTAT_URL),
};

export function getOfficialComponentWeight(metricId?: string): OfficialComponentWeight | null {
  return metricId ? officialWeights[metricId] ?? null : null;
}

export function formatOfficialComponentWeight(value: number): string {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value)}%`;
}
