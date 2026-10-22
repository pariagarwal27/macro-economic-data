import { US_PPI_SERIES } from './us-ppi.mjs';

/**
 * Live (release-day) source routing.
 * BLS/BEA are the primary sources for US CPI/PCE. FRED is fallback only.
 */

export type LiveProvider =
  | "bls"
  | "bea"
  | "ons"
  | "eurostat"
  | "adp"
  | "dol"
  | "atlanta_gdpnow"
  | "atlanta_sticky"
  | "atlanta_wage"
  | "nyfed"
  | "cleveland"
  | "cleveland_cpi"
  | "ecb"
  | "boe"
  | "lseg";

export interface LiveSeriesRef {
  provider: LiveProvider;
  /** Provider-native series id / table key */
  seriesId: string;
  /** Optional BEA table / extra params encoded as "TABLE:LINE" or similar */
  note?: string;
}

/** Map metric id → official live series (release-day source of truth). */
export const LIVE_MAP: Record<string, LiveSeriesRef> = {
  // Atlanta and Cleveland Fed underlying-inflation measures use their
  // publishers' downloadable datasets for both release refresh and history.
  "us-sticky-cpi": { provider: "atlanta_sticky", seriesId: "us-sticky-cpi" },
  "us-sticky-cpi-mom": { provider: "atlanta_sticky", seriesId: "us-sticky-cpi-mom" },
  "us-core-sticky-cpi": { provider: "atlanta_sticky", seriesId: "us-core-sticky-cpi" },
  "us-core-sticky-cpi-mom": { provider: "atlanta_sticky", seriesId: "us-core-sticky-cpi-mom" },
  "us-flexible-cpi": { provider: "atlanta_sticky", seriesId: "us-flexible-cpi" },
  "us-flexible-cpi-mom": { provider: "atlanta_sticky", seriesId: "us-flexible-cpi-mom" },
  "us-atlanta-wage": { provider: "atlanta_wage", seriesId: "WGT_OVERALL_3M_UNWEIGHTED" },
  "us-cleveland-median-cpi": { provider: "cleveland_cpi", seriesId: "us-cleveland-median-cpi" },
  "us-cleveland-median-cpi-mom": { provider: "cleveland_cpi", seriesId: "us-cleveland-median-cpi-mom" },
  "us-cleveland-trimmed-cpi": { provider: "cleveland_cpi", seriesId: "us-cleveland-trimmed-cpi" },
  "us-cleveland-trimmed-cpi-mom": { provider: "cleveland_cpi", seriesId: "us-cleveland-trimmed-cpi-mom" },
  // ---------------------------------------------------------------------------
  // LSEG Economic Indicators — PMI survey readings (local Workspace session)
  // ---------------------------------------------------------------------------
  "us-ism-manufacturing-pmi": { provider: "lseg", seriesId: "USPMI=ECI" },
  "us-ism-services-pmi": { provider: "lseg", seriesId: "USNPMI=ECI" },
  "us-sp-global-manufacturing-pmi": { provider: "lseg", seriesId: "USMPMF=ECI" },
  "us-sp-global-services-pmi": { provider: "lseg", seriesId: "USMPSF=ECI" },
  "uk-sp-global-manufacturing-pmi": { provider: "lseg", seriesId: "GBPMIM=ECI" },
  "uk-sp-global-services-pmi": { provider: "lseg", seriesId: "GBPMIS=ECI" },
  "uk-sp-global-composite-pmi": { provider: "lseg", seriesId: "GBCPMI=ECI" },
  "ea-sp-global-manufacturing-pmi": { provider: "lseg", seriesId: "EUPMI=ECI" },
  "ea-sp-global-services-pmi": { provider: "lseg", seriesId: "EUPMIS=ECI" },
  "ea-sp-global-composite-pmi": { provider: "lseg", seriesId: "EUPMIP=ECI" },

  // Euro-area zero-coupon HICP inflation swaps / inflation compensation.
  // The 5y5y observation is the LSEG middle-rate forward series; market data
  // requires the local Workspace bridge configured in LSEG_WORKER_URL.
  "ea-inflation-comp-1y": { provider: "lseg", seriesId: "EUHICP1Y=" },
  "ea-inflation-comp-2y": { provider: "lseg", seriesId: "EUHICP2Y=" },
  "ea-inflation-comp-5y": { provider: "lseg", seriesId: "EUHICP5Y=" },
  "ea-inflation-comp-10y": { provider: "lseg", seriesId: "EUHICP10Y=" },
  "ea-inflation-comp-5y5y": { provider: "lseg", seriesId: "EUIL5Y5Y=R" },

  // ---------------------------------------------------------------------------
  // BLS — Employment Situation
  // ---------------------------------------------------------------------------
  "us-nfp": {
    provider: "bls",
    seriesId: "CES0000000001",
  },
  "us-payrolls-level": {
    provider: "bls",
    seriesId: "CES0000000001",
  },
  "us-mfg-employment": {
    provider: "bls",
    seriesId: "CES3000000001",
  },
  "us-unemployment": {
    provider: "bls",
    seriesId: "LNS14000000",
  },
  "us-u6": {
    provider: "bls",
    seriesId: "LNS13327709",
  },
  "us-participation": {
    provider: "bls",
    seriesId: "LNS11300000",
  },
  "us-employment-population": {
    provider: "bls",
    seriesId: "LNS12300000",
  },
  "us-ahe": {
    provider: "bls",
    seriesId: "CES0500000003",
  },
  "us-avg-workweek": {
    provider: "bls",
    seriesId: "CES0500000002",
  },
  "us-temp-help": {
    provider: "bls",
    seriesId: "CES5613200001",
  },
    // ---------------------------------------------------------------------------
  // New York Fed — Survey of Consumer Expectations
  // ---------------------------------------------------------------------------
  "us-nyfed-sce-1y": {
    provider: "nyfed",
    seriesId: "SCE_INFLATION_1Y",
  },

  "us-nyfed-sce-3y": {
    provider: "nyfed",
    seriesId: "SCE_INFLATION_3Y",
  },

  "us-nyfed-sce-5y": {
    provider: "nyfed",
    seriesId: "SCE_INFLATION_5Y",
  },

  "us-nyfed-sce-1y-uncertainty": {
    provider: "nyfed",
    seriesId: "SCE_INFLATION_UNCERTAINTY_1Y",
  },

  // ---------------------------------------------------------------------------
  // Cleveland Fed — model-based inflation expectations
  // ---------------------------------------------------------------------------
  "us-cleveland-exp-inf-1y": { provider: "cleveland", seriesId: "EXPINF1YR" },
  "us-cleveland-exp-inf-2y": { provider: "cleveland", seriesId: "EXPINF2YR" },
  "us-cleveland-exp-inf-3y": { provider: "cleveland", seriesId: "EXPINF3YR" },
  "us-cleveland-exp-inf-5y": { provider: "cleveland", seriesId: "EXPINF5YR" },
  "us-cleveland-exp-inf-10y": { provider: "cleveland", seriesId: "EXPINF10YR" },
  "us-cleveland-exp-inf-30y": { provider: "cleveland", seriesId: "EXPINF30YR" },

  // ---------------------------------------------------------------------------
  // BLS — CPI / PPI / ECI / JOLTS
  // ---------------------------------------------------------------------------
  "us-cpi": {
    provider: "bls",
    seriesId: "CUSR0000SA0",
  },
  "us-cpi-yoy": {
    provider: "bls",
    seriesId: "CUUR0000SA0",
  },
  "us-cpi-mom": {
    provider: "bls",
    seriesId: "CUSR0000SA0",
  },
  "us-core-cpi-mom": {
    provider: "bls",
    seriesId: "CUSR0000SA0L1E",
  },
  "us-core-cpi-yoy": {
    provider: "bls",
    seriesId: "CUUR0000SA0L1E",
  },
  "us-core-goods-cpi-yoy": {
    provider: "bls",
    seriesId: "CUSR0000SACL1E",
  },
  "us-core-goods-cpi-mom": {
    provider: "bls",
    seriesId: "CUSR0000SACL1E",
  },
  "us-services-cpi-yoy": {
    provider: "bls",
    seriesId: "CUSR0000SASLE",
  },
  "us-services-cpi-mom": {
    provider: "bls",
    seriesId: "CUSR0000SASLE",
  },
  "us-cpi-nsa": {
    provider: "bls",
    seriesId: "CUUR0000SA0",
  },
  "us-cpi-core-nsa": {
    provider: "bls",
    seriesId: "CUUR0000SA0L1E",
  },
  "us-cpi-food": {
    provider: "bls",
    seriesId: "CUSR0000SAF1",
  },
  "us-cpi-energy": {
    provider: "bls",
    seriesId: "CUSR0000SA0E",
  },
  "us-cpi-apparel": {
    provider: "bls",
    seriesId: "CUSR0000SAA",
  },
  "us-cpi-new-vehicles": {
    provider: "bls",
    seriesId: "CUSR0000SETA01",
  },
  "us-cpi-used-cars": {
    provider: "bls",
    seriesId: "CUSR0000SETA02",
  },
  "us-cpi-medical-commodities": {
    provider: "bls",
    seriesId: "CUSR0000SAM1",
  },
  "us-cpi-recreation-commodities": {
    provider: "bls",
    seriesId: "CUSR0000SARC",
  },
  "us-cpi-education-commodities": {
    provider: "bls",
    seriesId: "CUSR0000SAEC",
  },
  "us-cpi-other-goods": {
    provider: "bls",
    seriesId: "CUSR0000SAGC",
  },
  "us-cpi-shelter": {
    provider: "bls",
    seriesId: "CUSR0000SAH1",
  },
  "us-cpi-medical-services": {
    provider: "bls",
    seriesId: "CUSR0000SAM2",
  },
  "us-cpi-recreation-services": {
    provider: "bls",
    seriesId: "CUSR0000SARS",
  },
  "us-cpi-transport-services": {
    provider: "bls",
    seriesId: "CUSR0000SAS4",
  },
  "us-cpi-education-services": {
    provider: "bls",
    seriesId: "CUSR0000SAES",
  },
  "us-cpi-other-services": {
    provider: "bls",
    seriesId: "CUSR0000SAS367",
  },

  "us-ppi-final-demand": {
    provider: "bls",
    seriesId: "WPUFD4",
  },
  "us-ppi-core": {
    provider: "bls",
    seriesId: "WPUFD49116",
  },
  "us-ppi-final-demand-mom": { provider: "bls", seriesId: "WPSFD4" },
  "us-ppi-core-mom": { provider: "bls", seriesId: "WPSFD49116" },
  "us-ppi-goods-yoy": { provider: "bls", seriesId: "WPUFD41" },
  "us-ppi-goods-mom": { provider: "bls", seriesId: "WPSFD41" },
  "us-ppi-foods-yoy": { provider: "bls", seriesId: "WPUFD411" },
  "us-ppi-foods-mom": { provider: "bls", seriesId: "WPSFD411" },
  "us-ppi-energy-yoy": { provider: "bls", seriesId: "WPUFD412" },
  "us-ppi-energy-mom": { provider: "bls", seriesId: "WPSFD412" },
  "us-ppi-goods-ex-food-energy-yoy": { provider: "bls", seriesId: "WPUFD413" },
  "us-ppi-goods-ex-food-energy-mom": { provider: "bls", seriesId: "WPSFD413" },
  "us-ppi-services-yoy": { provider: "bls", seriesId: "WPUFD42" },
  "us-ppi-services-mom": { provider: "bls", seriesId: "WPSFD42" },
  "us-ppi-services-ex-trade-yoy": { provider: "bls", seriesId: "WPUFD421" },
  "us-ppi-services-ex-trade-mom": { provider: "bls", seriesId: "WPSFD421" },
  "us-ppi-construction-yoy": { provider: "bls", seriesId: "WPUFD43" },
  "us-ppi-construction-mom": { provider: "bls", seriesId: "WPSFD43" },
  "us-ppi-final-demand-trade-yoy": { provider: "bls", seriesId: "WPUFD423" },
  "us-ppi-final-demand-trade-mom": { provider: "bls", seriesId: "WPSFD423" },
  "us-ppi-final-demand-transport-yoy": { provider: "bls", seriesId: "WPUFD422" },
  "us-ppi-final-demand-transport-mom": { provider: "bls", seriesId: "WPSFD422" },
  "us-ppi-intermediate-stage-1-yoy": { provider: "bls", seriesId: "WPUID51" },
  "us-ppi-intermediate-stage-1-mom": { provider: "bls", seriesId: "WPSID51" },
  "us-ppi-intermediate-stage-2-yoy": { provider: "bls", seriesId: "WPUID52" },
  "us-ppi-intermediate-stage-2-mom": { provider: "bls", seriesId: "WPSID52" },
  "us-ppi-intermediate-stage-3-yoy": { provider: "bls", seriesId: "WPUID53" },
  "us-ppi-intermediate-stage-3-mom": { provider: "bls", seriesId: "WPSID53" },
  "us-ppi-intermediate-stage-4-yoy": { provider: "bls", seriesId: "WPUID54" },
  "us-ppi-intermediate-stage-4-mom": { provider: "bls", seriesId: "WPSID54" },
  "us-ppi-intermediate-processed-goods-yoy": { provider: "bls", seriesId: "WPUID61" },
  "us-ppi-intermediate-processed-goods-mom": { provider: "bls", seriesId: "WPSID61" },
  "us-ppi-intermediate-unprocessed-goods-yoy": { provider: "bls", seriesId: "WPUID62" },
  "us-ppi-intermediate-unprocessed-goods-mom": { provider: "bls", seriesId: "WPSID62" },
  "us-ppi-intermediate-services-yoy": { provider: "bls", seriesId: "WPUID63" },
  "us-ppi-intermediate-services-mom": { provider: "bls", seriesId: "WPSID63" },
  "us-ppi-intermediate-construction-yoy": { provider: "bls", seriesId: "WPUID64" },
  "us-ppi-intermediate-construction-mom": { provider: "bls", seriesId: "WPSID64" },
  "us-eci-wages": {
    provider: "bls",
    seriesId: "CIS2020000000000Q",
  },
  "us-jolts-openings": {
    provider: "bls",
    seriesId: "JTS000000000000000JOL",
  },
  "us-jolts-quits": {
    provider: "bls",
    seriesId: "JTS000000000000000QUR",
  },
  "us-jolts-hires": {
    provider: "bls",
    seriesId: "JTS000000000000000HIR",
  },
  "us-jolts-layoffs": {
    provider: "bls",
    seriesId: "JTS000000000000000LDR",
  },

  "us-jolts-hires-level": {
    provider: "bls",
    seriesId: "JTS000000000000000HIL",
  },
  "us-jolts-quits-level": {
    provider: "bls",
    seriesId: "JTS000000000000000QUL",
  },
  "us-jolts-layoffs-level": {
    provider: "bls",
    seriesId: "JTS000000000000000LDL",
  },
  "us-jolts-total-separations": {
    provider: "bls",
    seriesId: "JTS000000000000000TSL",
  },

  // ---------------------------------------------------------------------------
  // DOL — Weekly unemployment claims
  // ---------------------------------------------------------------------------
  "us-initial-claims": {
    provider: "dol",
    seriesId: "initial",
  },
  "us-continuing-claims": {
    provider: "dol",
    seriesId: "continuing",
  },
  "us-initial-claims-4wk-average": {
    provider: "dol",
    seriesId: "initial-average",
  },
  "us-continuing-claims-4wk-average": {
    provider: "dol",
    seriesId: "continuing-average",
  },

  // ---------------------------------------------------------------------------
  // ADP
  // ---------------------------------------------------------------------------
  "us-adp-change": {
    provider: "adp",
    seriesId: "change",
  },
  "us-adp-level": {
    provider: "adp",
    seriesId: "level",
  },

  // ---------------------------------------------------------------------------
  // Atlanta Fed
  // ---------------------------------------------------------------------------
  "us-gdp-now": {
    provider: "atlanta_gdpnow",
    seriesId: "gdpnow",
  },

  // ---------------------------------------------------------------------------
  // New York Fed — Survey of Consumer Expectations
  //
  // Official SCE inflation-expectation horizons:
  //   1-year = short term
  //   3-year = medium term
  //   5-year = longer term
  // ---------------------------------------------------------------------------
  "us-nyfed-sce-inflation-exp-1y": {
    provider: "nyfed",
    seriesId: "SCE_INFLATION_1Y",
  },
  "us-nyfed-sce-inflation-exp-3y": {
    provider: "nyfed",
    seriesId: "SCE_INFLATION_3Y",
  },
  "us-nyfed-sce-inflation-exp-5y": {
    provider: "nyfed",
    seriesId: "SCE_INFLATION_5Y",
  },

  // ---------------------------------------------------------------------------
  // BEA — PCE price indexes
  // ---------------------------------------------------------------------------
  "us-pce": {
    provider: "bea",
    seriesId: "T20804:1",
    note: "PCE price index",
  },
  "us-core-pce": {
    provider: "bea",
    seriesId: "T20804:25",
    note: "PCE ex food and energy",
  },
  "us-pce-goods": {
    provider: "bea",
    seriesId: "T20804:2",
    note: "PCE goods",
  },
  "us-pce-durable-goods": {
    provider: "bea",
    seriesId: "T20804:3",
    note: "PCE durable goods",
  },
  "us-pce-furnishings": {
    provider: "bea",
    seriesId: "T20804:5",
    note: "PCE furnishings",
  },
  "us-pce-clothing": {
    provider: "bea",
    seriesId: "T20804:10",
    note: "PCE clothing and footwear",
  },
  "us-pce-food": {
    provider: "bea",
    seriesId: "T20804:9",
    note: "PCE food and beverages",
  },
  "us-pce-energy": {
    provider: "bea",
    seriesId: "T20804:11",
    note: "PCE gasoline and other energy goods",
  },
  "us-pce-services": {
    provider: "bea",
    seriesId: "T20804:13",
    note: "PCE services",
  },
  "us-pce-household-services": {
    provider: "bea",
    seriesId: "T20804:14",
    note: "PCE household services",
  },
  "us-pce-healthcare": {
    provider: "bea",
    seriesId: "T20804:16",
    note: "PCE health care",
  },
  "us-pce-food-services": {
    provider: "bea",
    seriesId: "T20804:19",
    note: "PCE food services and accommodations",
  },
  "us-pce-housing": {
    provider: "bea",
    seriesId: "T20804:29",
    note: "PCE housing",
  },

  // ---------------------------------------------------------------------------
  // BEA — GDP / PCE / Personal Spending
  // ---------------------------------------------------------------------------
  "us-gdp-real": {
    provider: "bea",
    seriesId: "T10101:1",
    note: "Real GDP % change SAAR",
  },
  "us-core-pce-mom": {
    provider: "bea",
    seriesId: "T20804:24",
    note: "PCE ex food energy",
  },
  "us-personal-spending": {
    provider: "bea",
    seriesId: "T20600:1",
    note: "Real PCE",
  },

  // ---------------------------------------------------------------------------
  // UK — ONS
  // ---------------------------------------------------------------------------
  "uk-cpih-yoy": {
    provider: "ons",
    seriesId: "L55O",
  },
  "uk-cpi-yoy": {
    provider: "ons",
    seriesId: "D7G7",
  },
  "uk-core-cpi-yoy": {
    provider: "ons",
    seriesId: "DKO8",
  },
  "uk-cpi-mom": {
    provider: "ons",
    seriesId: "D7OE",
  },
  "uk-core-cpi-mom": {
    provider: "ons",
    seriesId: "DKC6",
  },
  "uk-services-cpi-yoy": {
    provider: "ons",
    seriesId: "D7NN",
  },
  "uk-services-cpi-mom": {
    provider: "ons",
    seriesId: "D7MV",
  },
  "uk-goods-cpi-yoy": {
    provider: "ons",
    seriesId: "D7NM",
  },
  "uk-goods-cpi-mom": {
    provider: "ons",
    seriesId: "D7MU",
  },
  "uk-food-cpi-yoy": {
    provider: "ons",
    seriesId: "D7G8",
  },
  "uk-energy-cpi-yoy": {
    provider: "ons",
    seriesId: "D7GT",
  },
  "uk-housing-cpi-yoy": {
    provider: "ons",
    seriesId: "D7GB",
  },
  "uk-rpi-yoy": {
    provider: "ons",
    seriesId: "CZBH",
  },
  "uk-ppi-input-yoy": {
    provider: "ons",
    seriesId: "GHIP",
  },
  "uk-ppi-output-yoy": {
    provider: "ons",
    seriesId: "GB7S",
  },
  "uk-ppi-output-mom": { provider: "ons", seriesId: "GB7S" },
  "uk-ppi-input-mom": { provider: "ons", seriesId: "GHIP" },
  "uk-ppi-food-beverages-tobacco-yoy": { provider: "ons", seriesId: "GBA7" },
  "uk-ppi-food-beverages-tobacco-mom": { provider: "ons", seriesId: "GBA7" },
  "uk-ppi-alcohol-tobacco-yoy": { provider: "ons", seriesId: "GB7V" },
  "uk-ppi-alcohol-tobacco-mom": { provider: "ons", seriesId: "GB7V" },
  "uk-ppi-textiles-yoy": { provider: "ons", seriesId: "GB7W" },
  "uk-ppi-textiles-mom": { provider: "ons", seriesId: "GB7W" },
  "uk-ppi-paper-yoy": { provider: "ons", seriesId: "GB7X" },
  "uk-ppi-paper-mom": { provider: "ons", seriesId: "GB7X" },
  "uk-ppi-petroleum-yoy": { provider: "ons", seriesId: "GB7Y" },
  "uk-ppi-petroleum-mom": { provider: "ons", seriesId: "GB7Y" },
  "uk-ppi-chemicals-yoy": { provider: "ons", seriesId: "GB7Z" },
  "uk-ppi-chemicals-mom": { provider: "ons", seriesId: "GB7Z" },
  "uk-ppi-metals-machinery-yoy": { provider: "ons", seriesId: "GB82" },
  "uk-ppi-metals-machinery-mom": { provider: "ons", seriesId: "GB82" },
  "uk-ppi-computers-electronics-yoy": { provider: "ons", seriesId: "GB83" },
  "uk-ppi-computers-electronics-mom": { provider: "ons", seriesId: "GB83" },
  "uk-ppi-vehicles-yoy": { provider: "ons", seriesId: "GB84" },
  "uk-ppi-vehicles-mom": { provider: "ons", seriesId: "GB84" },
  "uk-ppi-input-manufactured-yoy": { provider: "ons", seriesId: "FSQT" },
  "uk-ppi-input-manufactured-mom": { provider: "ons", seriesId: "FSQT" },
  "uk-ppi-input-fuel-yoy": { provider: "ons", seriesId: "FSQ3" },
  "uk-ppi-input-fuel-mom": { provider: "ons", seriesId: "FSQ3" },
  "uk-ppi-input-petroleum-ores-yoy": { provider: "ons", seriesId: "FSQ4" },
  "uk-ppi-input-petroleum-ores-mom": { provider: "ons", seriesId: "FSQ4" },
  "uk-ppi-input-beverages-tobacco-yoy": { provider: "ons", seriesId: "FSQ5" },
  "uk-ppi-input-beverages-tobacco-mom": { provider: "ons", seriesId: "FSQ5" },
  "uk-ppi-input-other-yoy": { provider: "ons", seriesId: "FSQ6" },
  "uk-ppi-input-other-mom": { provider: "ons", seriesId: "FSQ6" },
  "uk-ppi-input-chemicals-yoy": { provider: "ons", seriesId: "FSQ7" },
  "uk-ppi-input-chemicals-mom": { provider: "ons", seriesId: "FSQ7" },
  "uk-ppi-input-metals-yoy": { provider: "ons", seriesId: "FSQ8" },
  "uk-ppi-input-metals-mom": { provider: "ons", seriesId: "FSQ8" },
  "uk-ppi-input-equipment-yoy": { provider: "ons", seriesId: "FSQ9" },
  "uk-ppi-input-equipment-mom": { provider: "ons", seriesId: "FSQ9" },
  "uk-ppi-input-domestic-food-yoy": { provider: "ons", seriesId: "FSP7" },
  "uk-ppi-input-domestic-food-mom": { provider: "ons", seriesId: "FSP7" },
  "uk-ppi-input-imported-food-yoy": { provider: "ons", seriesId: "FSP9" },
  "uk-ppi-input-imported-food-mom": { provider: "ons", seriesId: "FSP9" },
  "uk-ppi-import-yoy": { provider: "ons", seriesId: "GD74" },
  "uk-ppi-import-mom": { provider: "ons", seriesId: "GD74" },
  "uk-ppi-export-yoy": { provider: "ons", seriesId: "GB7R" },
  "uk-ppi-export-mom": { provider: "ons", seriesId: "GB7R" },
  "uk-awe-regular-yoy": {
    provider: "ons",
    seriesId: "KAI9",
  },
  "uk-awe-total-yoy": {
    provider: "ons",
    seriesId: "KAC3",
  },
  "uk-vacancies": {
    provider: "ons",
    seriesId: "AP2Y",
  },
  "uk-gdp-yoy": {
    provider: "ons",
    seriesId: "IHYR",
  },
  "uk-gdp-qoq": {
    provider: "ons",
    seriesId: "IHYQ",
  },
  "uk-gdp-mom": {
    provider: "ons",
    seriesId: "ECYX",
  },
  "uk-gdp-3m-yoy": {
    provider: "ons",
    seriesId: "ED9T",
  },
  "uk-unemployment": {
    provider: "ons",
    seriesId: "MGSX",
  },
  "uk-employment-level": {
    provider: "ons",
    seriesId: "MGRZ",
  },
  "uk-industrial-production": {
    provider: "ons",
    seriesId: "K222",
  },
  "uk-retail-sales": {
    provider: "ons",
    seriesId: "J5EK",
  },
  "uk-retail-sales-total-yoy": {
    provider: "ons",
    seriesId: "J5EB",
  },
  "uk-retail-sales-ex-fuel-yoy": {
    provider: "ons",
    seriesId: "J45U",
  },

  // ---------------------------------------------------------------------------
  // Euro Area — Eurostat
  // ---------------------------------------------------------------------------
  "ea-hicp-yoy": {
    provider: "eurostat",
    seriesId: "prc_hicp_minr",
  },
  "ea-core-hicp-yoy": {
    provider: "eurostat",
    seriesId: "prc_hicp_minr_core",
  },
  "ea-hicp-mom": {
    provider: "eurostat",
    seriesId: "prc_hicp_mmor",
  },
  "ea-core-hicp-mom": {
    provider: "eurostat",
    seriesId: "prc_hicp_mmor_core",
  },
  "ea-services-hicp-yoy": {
    provider: "eurostat",
    seriesId: "prc_hicp_minr_serv",
  },
  "ea-services-hicp-mom": {
    provider: "eurostat",
    seriesId: "prc_hicp_mmor_serv",
  },
  "ea-goods-hicp-yoy": {
    provider: "eurostat",
    seriesId: "prc_hicp_minr_igd_nnrg",
  },
  "ea-goods-hicp-mom": {
    provider: "eurostat",
    seriesId: "prc_hicp_mmor_igd_nnrg",
  },
  "ea-food-hicp-yoy": {
    provider: "eurostat",
    seriesId: "prc_hicp_minr_food",
  },
  "ea-food-hicp-mom": {
    provider: "eurostat",
    seriesId: "prc_hicp_mmor_food",
  },
  "ea-energy-hicp-yoy": {
    provider: "eurostat",
    seriesId: "prc_hicp_minr_nrg",
  },
  "ea-energy-hicp-mom": {
    provider: "eurostat",
    seriesId: "prc_hicp_mmor_nrg",
  },
  "de-cpi-yoy": {
    provider: "eurostat",
    seriesId: "prc_hicp_minr_DE",
  },
  "fr-cpi-yoy": {
    provider: "eurostat",
    seriesId: "prc_hicp_minr_FR",
  },
  "it-cpi-yoy": {
    provider: "eurostat",
    seriesId: "prc_hicp_minr_IT",
  },
  "es-cpi-yoy": {
    provider: "eurostat",
    seriesId: "prc_hicp_minr_ES",
  },
  "ea-unemployment": {
    provider: "eurostat",
    seriesId: "une_rt_m",
  },
  "ea-youth-unemployment": {
    provider: "eurostat",
    seriesId: "une_rt_m_youth",
  },
  "ea-unemployed-persons": {
    provider: "eurostat",
    seriesId: "ei_lmhu_m",
  },
  "ea-employment-yoy": {
    provider: "eurostat",
    seriesId: "ei_lmhu_m",
  },
  "ea-ppi-yoy": {
    provider: "eurostat",
    seriesId: "ea-ppi:B-E36:PCH_SM",
  },
  "ea-ppi-mom": { provider: "eurostat", seriesId: "ea-ppi:B-E36:PCH_PRE" },
  "ea-ppi-capital-goods-yoy": { provider: "eurostat", seriesId: "ea-ppi:MIG_CAG:PCH_SM" },
  "ea-ppi-capital-goods-mom": { provider: "eurostat", seriesId: "ea-ppi:MIG_CAG:PCH_PRE" },
  "ea-ppi-intermediate-goods-yoy": { provider: "eurostat", seriesId: "ea-ppi:MIG_ING:PCH_SM" },
  "ea-ppi-intermediate-goods-mom": { provider: "eurostat", seriesId: "ea-ppi:MIG_ING:PCH_PRE" },
  "ea-ppi-durable-consumer-goods-yoy": { provider: "eurostat", seriesId: "ea-ppi:MIG_DCOG:PCH_SM" },
  "ea-ppi-durable-consumer-goods-mom": { provider: "eurostat", seriesId: "ea-ppi:MIG_DCOG:PCH_PRE" },
  "ea-ppi-non-durable-consumer-goods-yoy": { provider: "eurostat", seriesId: "ea-ppi:MIG_NDCOG:PCH_SM" },
  "ea-ppi-non-durable-consumer-goods-mom": { provider: "eurostat", seriesId: "ea-ppi:MIG_NDCOG:PCH_PRE" },
  "ea-ppi-energy-yoy": { provider: "eurostat", seriesId: "ea-ppi:MIG_NRG:PCH_SM" },
  "ea-ppi-energy-mom": { provider: "eurostat", seriesId: "ea-ppi:MIG_NRG:PCH_PRE" },
  "ea-industrial-production": {
    provider: "eurostat",
    seriesId: "sts_inpr_m",
  },
  "ea-retail-sales": {
    provider: "eurostat",
    seriesId: "ei_isrr_m",
  },
  "ea-esi": {
    provider: "eurostat",
    seriesId: "ei_bssi_esi",
  },
  "ea-business-confidence": {
    provider: "eurostat",
    seriesId: "ei_bssi_ici",
  },
};

// One verified FD-ID manifest supplies both headline and nested PPI routes.
Object.assign(LIVE_MAP, ...US_PPI_SERIES.flatMap(series => [
  { [series.id]: { provider: 'bls', seriesId: series.seriesId } },
  { [series.momId]: { provider: 'bls', seriesId: series.saSeriesId } },
]));

export function liveSeriesIdsForProvider(
  provider: LiveProvider
): string[] {
  return [
    ...new Set(
      Object.values(LIVE_MAP)
        .filter((v) => v.provider === provider)
        .map((v) => v.seriesId)
    ),
  ];
}
