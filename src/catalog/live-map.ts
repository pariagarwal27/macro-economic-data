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
  | "nyfed"
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
  // BLS — CPI / PPI / ECI / JOLTS
  // ---------------------------------------------------------------------------
  "us-cpi": {
    provider: "bls",
    seriesId: "CUSR0000SA0",
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
    seriesId: "WPSFD49207",
  },
  "us-ppi-core": {
    provider: "bls",
    seriesId: "WPSFD4131",
  },
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
    seriesId: "JTS000000000000000HIR",
  },
  "us-jolts-quits-level": {
    provider: "bls",
    seriesId: "JTS000000000000000QUR",
  },
  "us-jolts-layoffs-level": {
    provider: "bls",
    seriesId: "JTS000000000000000LDR",
  },
  "us-jolts-total-separations": {
    provider: "bls",
    seriesId: "JTS000000000000000TSR",
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
    seriesId: "prc_hicp_minr_goods",
  },
  "ea-food-hicp-yoy": {
    provider: "eurostat",
    seriesId: "prc_hicp_minr_food",
  },
  "ea-energy-hicp-yoy": {
    provider: "eurostat",
    seriesId: "prc_hicp_minr_nrg",
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
    seriesId: "sts_inpp_m",
  },
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