export type OfficialComponentWeight = {
  /** Share of the all-items consumer price basket, expressed as percent. */
  value: number;
  year: number;
  validFrom: string;
  basis: string;
  source: string;
};

const BLS_2026 = "BLS CPI-U relative importance, December 2025 weights used for 2026";
const ONS_CPI_2026 = "ONS CPI, February–December 2026 weights (ppt converted to percent)";
const ONS_CPIH_2026 = "ONS CPIH, February–December 2026 weights (ppt converted to percent)";
const EUROSTAT_2026 = "Eurostat euro-area HICP 2026 weights (‰ converted to percent)";

const BLS_URL = "https://www.bls.gov/cpi/tables/relative-importance/2025.htm";
const BLS_2025_URL = "https://www.bls.gov/cpi/tables/relative-importance/2024.htm";
const BLS_2024_URL = "https://www.bls.gov/cpi/tables/relative-importance/2023.htm";
const BLS_JAN_2024_URL = "https://www.bls.gov/news.release/archives/cpi_02132024.htm";
const BLS_JAN_2025_URL = "https://www.bls.gov/news.release/archives/cpi_02122025.htm";
const BLS_DEC_2025_RELEASE_URL = "https://www.bls.gov/news.release/archives/cpi_01132026.htm";
const BLS_SEP_2026_RELEASE_URL = "https://www.bls.gov/news.release/cpi.t02.htm";
const ONS_URL = "https://www.ons.gov.uk/economy/inflationandpriceindices/articles/consumerpriceinflationupdatingweights/2026";
const EUROSTAT_URL = "https://ec.europa.eu/eurostat/statistics-explained/SEPDF/cache/18881.pdf?v=1250650036640850";

const weight = (value: number, basis: string, source: string): OfficialComponentWeight => ({
  value,
  year: 2026,
  validFrom: basis === ONS_CPI_2026 || basis === ONS_CPIH_2026 ? "2026-02" : "2026-01",
  basis,
  source,
});

const officialWeights: Record<string, OfficialComponentWeight> = {
  // BLS CPI-U relative importance: percent of all items, December 2025
  // expenditure weights, the official weight set applied to 2026.
  "us-cpi": weight(100, BLS_2026, BLS_URL),
  "us-cpi-core": weight(79.919, BLS_2026, BLS_URL),
  "us-core-goods-cpi-yoy": weight(19.176, BLS_2026, BLS_URL),
  "us-services-cpi-yoy": weight(60.744, BLS_2026, BLS_URL),
  "us-cpi-food": weight(13.698, BLS_2026, BLS_URL),
  "us-cpi-energy": weight(6.383, BLS_2026, BLS_URL),
  "us-cpi-shelter": weight(35.625, BLS_2026, BLS_URL),
  "us-cpi-apparel": weight(2.368, BLS_2026, BLS_URL),
  "us-cpi-new-vehicles": weight(3.838, BLS_2026, BLS_URL),
  "us-cpi-used-cars": weight(2.759, BLS_2026, BLS_URL),
  "us-cpi-medical-commodities": weight(1.489, BLS_2026, BLS_URL),
  "us-cpi-medical-services": weight(6.935, BLS_2026, BLS_URL),
  "us-cpi-recreation-commodities": weight(1.821, BLS_2026, BLS_URL),
  // Detailed component weights published in BLS's December 2025 CPI release.
  // The relative-importance page does not expose these intermediate groups.
  "us-cpi-education-commodities": weight(0.716, BLS_2026, BLS_DEC_2025_RELEASE_URL),
  "us-cpi-recreation-services": weight(3.425, BLS_2026, BLS_DEC_2025_RELEASE_URL),
  "us-cpi-education-services": weight(4.951, BLS_2026, BLS_DEC_2025_RELEASE_URL),
  "us-cpi-other-goods": weight(1.299, BLS_2026, BLS_DEC_2025_RELEASE_URL),
  "us-cpi-other-services": weight(9.845, BLS_2026, BLS_URL),
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

// December 2024 relative importance using the 2023 expenditure weights,
// corresponding to the basket introduced with January 2025 CPI. Detailed
// aggregate weights are from the January 2025 release's December column.
const bls2025: Record<string, number> = {
  "us-cpi": 100, "us-cpi-core": 80.094,
  "us-core-goods-cpi-yoy": 19.388, "us-services-cpi-yoy": 60.705,
  "us-cpi-food": 13.691, "us-cpi-energy": 6.216, "us-cpi-shelter": 35.483,
  "us-cpi-apparel": 2.480, "us-cpi-new-vehicles": 4.393, "us-cpi-used-cars": 2.391,
  "us-cpi-medical-commodities": 1.527, "us-cpi-medical-services": 6.747,
  "us-cpi-recreation-commodities": 1.847, "us-cpi-education-commodities": 0.752,
  "us-cpi-recreation-services": 3.445, "us-cpi-education-services": 4.980,
  "us-cpi-other-goods": 1.289, "us-cpi-other-services": 10.061, "us-cpi-transport-services": 6.305,
};
const bls2025Detailed = new Set(["us-cpi-recreation-commodities", "us-cpi-education-commodities", "us-cpi-recreation-services", "us-cpi-education-services", "us-cpi-other-goods"]);

// December 2023 reference weights for the 2024 CPI basket.
const bls2024: Record<string, number> = {
  "us-cpi": 100, "us-cpi-core": 79.790,
  "us-core-goods-cpi-yoy": 18.891, "us-services-cpi-yoy": 60.899,
  "us-cpi-food": 13.555, "us-cpi-energy": 6.655, "us-cpi-shelter": 36.191,
  "us-cpi-apparel": 2.512, "us-cpi-new-vehicles": 3.684, "us-cpi-used-cars": 2.012,
  "us-cpi-medical-commodities": 1.489, "us-cpi-medical-services": 6.515,
  "us-cpi-recreation-commodities": 2.041, "us-cpi-education-commodities": 0.868,
  "us-cpi-recreation-services": 3.265, "us-cpi-education-services": 5.038,
  "us-cpi-other-goods": 1.372, "us-cpi-other-services": 9.830, "us-cpi-transport-services": 6.294,
};

// BLS Table 2 in the September 2026 CPI release reports relative importance
// for August 2026. Those are the effective all-items basket shares to use for
// the September 2026 card. Values are percent of all items. Core aggregate
// groups and named categories are official. BLS does not report a September
// month-relative-importance figure for the special aggregate "Other services"
// in Table 2, so that row retains its official December 2025 annual reference
// weight instead of using an invented residual.
const bls2026Sep: Record<string, number> = {
  "us-cpi": 100,
  "us-cpi-core": 79.075,
  "us-core-goods-cpi-yoy": 18.835,
  "us-services-cpi-yoy": 60.240,
  "us-cpi-food": 13.507,
  "us-cpi-energy": 7.418,
  "us-cpi-shelter": 35.323,
  "us-cpi-apparel": 2.445,
  "us-cpi-new-vehicles": 3.748,
  "us-cpi-used-cars": 2.688,
  "us-cpi-medical-commodities": 1.396,
  "us-cpi-medical-services": 6.834,
  "us-cpi-recreation-commodities": 1.922,
  "us-cpi-education-commodities": 0.789,
  "us-cpi-recreation-services": 3.141,
  "us-cpi-education-services": 5.018,
  "us-cpi-other-goods": 1.300,
  "us-cpi-transport-services": 6.261,
};

export function getOfficialComponentWeight(metricId?: string, period?: string): OfficialComponentWeight | null {
  if (!metricId) return null;
  if (period === "2026-09" && metricId === "us-cpi-other-services") return {
    value: 9.845, year: 2026, validFrom: "2026-01",
    basis: "BLS 2026 annual reference weight: December 2025 relative importance; September 2026 monthly relative importance is not published for this special aggregate",
    source: BLS_URL,
  };
  if (period === "2026-09" && metricId in bls2026Sep) return {
    value: bls2026Sep[metricId], year: 2026, validFrom: "2026-09",
    basis: "BLS CPI-U August 2026 relative importance, used for September 2026 CPI",
    source: BLS_SEP_2026_RELEASE_URL,
  };
  if (period?.startsWith("2024-") && metricId in bls2024) return {
    value: bls2024[metricId], year: 2024, validFrom: "2024-01",
    basis: "BLS CPI-U December 2023 relative importance using 2022 expenditure weights; fixed reference approximation for 2024",
    source: bls2025Detailed.has(metricId) ? BLS_JAN_2024_URL : BLS_2024_URL,
  };
  if (period?.startsWith("2025-") && metricId in bls2025) return {
    value: bls2025[metricId], year: 2025, validFrom: "2025-01",
    basis: "BLS CPI-U December 2024 relative importance using 2023 expenditure weights; fixed reference approximation for 2025",
    source: bls2025Detailed.has(metricId) ? BLS_JAN_2025_URL : BLS_2025_URL,
  };
  const current = officialWeights[metricId] ?? null;
  return !period || !current || (period.startsWith(`${current.year}-`) && period >= current.validFrom) ? current : null;
}

export function formatOfficialComponentWeight(value: number): string {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value)}%`;
}
