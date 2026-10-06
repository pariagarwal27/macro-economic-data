export type Region = "US" | "UK" | "EA";
export type MacroCategory = "inflation" | "growth" | "jobs";

export type UiNode = {
  id: string;
  label: string;
  metricId?: string;
  children?: UiNode[];
};

export type IndicatorSpec = {
  id: string;
  title?: string;
  metricId: string;
  yoyMetricId?: string;
  momMetricId?: string;
expectationGroup?:
  | "consumer"
  | "business"
  | "market"
  | "professional"
  | "wage"
  | "model";

  chartMetricIds?: string[];
  components?: UiNode[];
};

const n = (id: string, label: string, metricId?: string, children?: UiNode[]): UiNode => ({
  id, label, ...(metricId ? { metricId } : {}), ...(children?.length ? { children } : {}),
});

export const DASHBOARD: Record<Region, Record<MacroCategory, IndicatorSpec[]>> = {
  US: {
  inflation: [
 {
  id: "us-cpi-card",
  metricId: "us-cpi",
  momMetricId: "us-cpi-mom",
  title: "CPI (Headline)",
  components: [
        n("food", "Food", "us-cpi-food"),
        n("energy", "Energy", "us-cpi-energy"),
        n("core", "Core CPI", "us-cpi-core", [
          n("core-goods", "Core Goods", undefined, [
            n("apparel", "Apparel", "us-cpi-apparel"),
            n("new-vehicles", "New Vehicles", "us-cpi-new-vehicles"),
            n("used-cars", "Used Cars & Trucks", "us-cpi-used-cars"),
            n("medical-goods", "Medical Care Commodities", "us-cpi-medical-commodities"),
            n("recreation-goods", "Recreation Commodities", "us-cpi-recreation-commodities"),
            n("education-goods", "Education & Communication Commodities", "us-cpi-education-commodities"),
            n("other-goods", "Other Core Goods", "us-cpi-other-goods"),
          ]),
          n("core-services", "Core Services", undefined, [
            n("shelter", "Shelter", "us-cpi-shelter"),
            n("medical", "Medical Care", "us-cpi-medical-services"),
            n("transport", "Transportation Services", "us-cpi-transport-services"),
            n("recreation-services", "Recreation Services", "us-cpi-recreation-services"),
            n("education-services", "Education & Communication", "us-cpi-education-services"),
            n("other-services", "Other Services", "us-cpi-other-services"),
          ]),
        ]),
      ],
    },

    {
      id: "us-core-cpi-card",
      metricId: "us-cpi-core",
      title: "Core CPI",
      components: [
        n("core-goods", "Core Goods", undefined, [
          n("apparel", "Apparel", "us-cpi-apparel"),
          n("new-vehicles", "New Vehicles", "us-cpi-new-vehicles"),
          n("used-cars", "Used Cars & Trucks", "us-cpi-used-cars"),
          n("medical-goods", "Medical Care Commodities", "us-cpi-medical-commodities"),
          n("recreation-goods", "Recreation Commodities", "us-cpi-recreation-commodities"),
          n("education-goods", "Education & Communication Commodities", "us-cpi-education-commodities"),
          n("other-goods", "Other Core Goods", "us-cpi-other-goods"),
        ]),
        n("core-services", "Core Services", undefined, [
          n("shelter", "Shelter", "us-cpi-shelter"),
          n("medical", "Medical Care", "us-cpi-medical-services"),
          n("transport", "Transportation Services", "us-cpi-transport-services"),
          n("recreation-services", "Recreation Services", "us-cpi-recreation-services"),
          n("education-services", "Education & Communication", "us-cpi-education-services"),
          n("other-services", "Other Services", "us-cpi-other-services"),
        ]),
      ],
    },

    {
      id: "us-pce-card",
      metricId: "us-pce",
      title: "PCE (Headline)",
      components: [
        n("core", "Core PCE", "us-core-pce"),
        n("goods", "Goods", "us-pce-goods", [
          n("durable", "Durable Goods", "us-pce-durable-goods"),
          n("furnishings", "Furnishings & Durable Household Equipment", "us-pce-furnishings"),
          n("clothing", "Clothing & Footwear", "us-pce-clothing"),
        ]),
        n("services", "Services", "us-pce-services", [
          n("household", "Household Services", "us-pce-household-services"),
          n("healthcare", "Health Care", "us-pce-healthcare"),
          n("housing", "Housing", "us-pce-housing"),
          n("food-services", "Food Services & Accommodations", "us-pce-food-services"),
        ]),
        n("food", "Food & Beverages", "us-pce-food"),
        n("energy", "Gasoline & Other Energy Goods", "us-pce-energy"),
      ],
    },

    {
      id: "us-core-pce-card",
      metricId: "us-core-pce",
      title: "Core PCE",
      components: [],
    },
    // ----------------------------------------------------
// US INFLATION EXPECTATIONS
// ----------------------------------------------------

{
  id: "us-inflation-expectations-consumer",
  metricId: "us-cleveland-exp-inf-1y",
  title: "Consumer Expectations",
  expectationGroup: "consumer",
  components: [
    n("cleveland-1y", "Cleveland Fed — 1-Year", "us-cleveland-exp-inf-1y"),
    n("umich-1y", "University of Michigan — 1-Year", "us-umich-inflation-exp-1y"),
  ],
  chartMetricIds: [
    "us-cleveland-exp-inf-1y",
    "us-cleveland-exp-inf-3y",
    "us-cleveland-exp-inf-5y",
    "us-umich-inflation-exp-1y",
    "us-umich-inflation-exp-5y",
  ],
},

{
  id: "us-inflation-expectations-wage",
  metricId: "us-nyfed-sce-labor-earnings-1y",
  title: "Wage Expectations",
  expectationGroup: "wage",
  components: [
    n("sce-inflation-1y", "NY Fed SCE Inflation — 1-Year", "us-nyfed-sce-1y"),
    n("sce-inflation-3y", "NY Fed SCE Inflation — 3-Year", "us-nyfed-sce-3y"),
    n("sce-inflation-5y", "NY Fed SCE Inflation — 5-Year", "us-nyfed-sce-5y"),

    n("sce-earnings-1y", "NY Fed SCE Earnings Growth — 1-Year", "us-nyfed-sce-labor-earnings-1y"),
    n("sce-job-separation-1y", "NY Fed SCE Job Separation — 1-Year", "us-nyfed-sce-labor-job-separation-1y"),
    n("sce-job-finding-1y", "NY Fed SCE Job Finding — 1-Year", "us-nyfed-sce-labor-job-finding-1y"),
    n("sce-unemployment-1y", "NY Fed SCE Unemployment Expectations — 1-Year", "us-nyfed-sce-labor-unemployment-1y"),

    n("sce-income-1y", "NY Fed SCE Household Income Growth — 1-Year", "us-nyfed-sce-finance-income-1y"),
    n("sce-spending-1y", "NY Fed SCE Household Spending Growth — 1-Year", "us-nyfed-sce-finance-spending-1y"),
    n("sce-tax-1y", "NY Fed SCE Tax Change — 1-Year", "us-nyfed-sce-finance-tax-1y"),

    n("atlanta-wage", "Atlanta Fed Wage Growth Tracker", "us-atlanta-wage"),
  ],
  chartMetricIds: [
    "us-nyfed-sce-1y",
    "us-nyfed-sce-3y",
    "us-nyfed-sce-5y",
    "us-nyfed-sce-labor-earnings-1y",
    "us-nyfed-sce-labor-job-separation-1y",
    "us-nyfed-sce-labor-job-finding-1y",
    "us-nyfed-sce-labor-unemployment-1y",
    "us-nyfed-sce-finance-income-1y",
    "us-nyfed-sce-finance-spending-1y",
    "us-nyfed-sce-finance-tax-1y",
    "us-atlanta-wage",
  ],
},

{
  id: "us-inflation-expectations-business",
  metricId: "us-atlanta-bie-1y",
  title: "Business Expectations",
  expectationGroup: "business",
  components: [
    n("atlanta-bie", "Atlanta Fed BIE", "us-atlanta-bie-1y"),
    n("cleveland-sofie", "Cleveland Fed SoFIE", "us-cleveland-sofie-1y"),
  ],
  chartMetricIds: [
    "us-atlanta-bie-1y",
    "us-cleveland-sofie-1y",
  ],
},

{
  id: "us-inflation-expectations-market",
  metricId: "us-5y5y-forward",
  title: "Market-Based",
  expectationGroup: "market",
  components: [
    n("be-5y5y", "5Y5Y Forward", "us-5y5y-forward"),
    n("be-5y", "5-Year Breakeven", "us-breakeven-5y"),
    n("be-10y", "10-Year Breakeven", "us-breakeven-10y"),
  ],
  chartMetricIds: [
    "us-5y5y-forward",
    "us-breakeven-5y",
    "us-breakeven-10y",
  ],
},

{
  id: "us-inflation-expectations-model",
  metricId: "us-cleveland-exp-inf-1y",
  title: "Model-Based",
  expectationGroup: "model",
  components: [
    n("cleveland-1y", "Cleveland Fed — 1-Year", "us-cleveland-exp-inf-1y"),
    n("cleveland-5y", "Cleveland Fed — 5-Year", "us-cleveland-exp-inf-5y"),
  ],
  chartMetricIds: [
    "us-cleveland-exp-inf-1y",
    "us-cleveland-exp-inf-5y",
  ],
},
  ],
    growth: [
      {
        id: "us-gdp-card", metricId: "us-gdp-real", title: "Real GDP",
        components: [
          n("gdp", "Real GDP", "us-gdp-real"),
          n("pce", "Personal Consumption", "us-real-pce-growth"),
          n("investment", "Private Investment", "us-real-private-investment"),
          n("net-exports", "Net Exports", "us-real-net-exports"),
          n("government", "Government", "us-real-government"),
        ],
      },
      {
  id: "us-retail-sales-card",
  metricId: "us-retail-sales-total",
  title: "Retail Sales",
  components: [
    n("motor-vehicles", "Motor Vehicles", "us-retail-motor-vehicles"),
    n("gasoline", "Gasoline Stations", "us-retail-gasoline"),
    n("food-beverage", "Food & Beverage", "us-retail-food-beverage"),
    n("general-merchandise", "General Merchandise", "us-retail-general-merchandise"),
    n("nonstore", "Nonstore (Online)", "us-retail-nonstore"),
    n("food-services", "Food Services", "us-retail-food-services"),
    n("total", "Total", "us-retail-sales-total"),
    n("total-ex-auto-gas", "Total ex Autos & Gas", "us-retail-total-ex-auto-gas"),
  ],
},

{
  id: "us-pmi-card",
  metricId: "us-ism-manufacturing-pmi",
  title: "PMI",
  components: [
    n("ism-manufacturing", "ISM Manufacturing", "us-ism-manufacturing-pmi"),
    n("ism-services", "ISM Services", "us-ism-services-pmi"),
    n("sp-global-manufacturing", "S&P Global Manufacturing", "us-sp-global-manufacturing-pmi"),
    n("sp-global-services", "S&P Global Services", "us-sp-global-services-pmi"),
  ],
},
      {
        id: "us-pce-growth-card", metricId: "us-real-pce-growth", title: "Personal Consumption",
        components: [
          n("pce", "Personal Consumption Expenditures", "us-real-pce-growth"),
          n("goods", "Goods", "us-real-pce-goods", [
            n("durable", "Durable Goods", "us-real-pce-durable-goods"),
            n("nondurable", "Nondurable Goods", "us-real-pce-nondurable-goods"),
          ]),
          n("services", "Services", "us-real-pce-services"),
        ],
      },
      {
        id: "us-investment-card", metricId: "us-real-private-investment", title: "Gross Private Domestic Investment",
        components: [
          n("private", "Gross Private Domestic Investment", "us-real-private-investment"),
          n("fixed", "Fixed Investment", "us-real-fixed-investment", [
            n("nonresidential", "Nonresidential", "us-real-nonresidential-investment", [
              n("structures", "Structures", "us-real-structures"),
              n("equipment", "Equipment", "us-real-equipment"),
              n("ipp", "Intellectual Property Products", "us-real-ipp"),
            ]),
            n("residential", "Residential", "us-real-residential-investment"),
          ]),
          n("inventories", "Change in Private Inventories", "us-real-inventories"),
        ],
      },
      {
        id: "us-net-exports-card", metricId: "us-real-net-exports", title: "Net Exports",
        components: [
          n("net", "Net Exports", "us-real-net-exports"),
          n("exports", "Exports", "us-real-exports", [
            n("goods", "Goods", "us-real-export-goods"),
            n("services", "Services", "us-real-export-services"),
          ]),
          n("imports", "Imports", "us-real-imports", [
            n("goods", "Goods", "us-real-import-goods"),
            n("services", "Services", "us-real-import-services"),
          ]),
        ],
      },
      {
        id: "us-government-card", metricId: "us-real-government", title: "Government Consumption & Investment",
        components: [
          n("government", "Government", "us-real-government", [
            n("federal", "Federal", "us-real-federal-government", [
              n("defense", "National Defense", "us-real-defense"),
              n("nondefense", "Nondefense", "us-real-nondefense"),
            ]),
            n("state-local", "State & Local", "us-real-state-local"),
          ]),
        ],
      },
      
    ],
    jobs: [
      {
        id: "us-unemployment-card", metricId: "us-unemployment", title: "Unemployment",
        components: [
          n("rate", "Unemployment Rate", "us-unemployment"),
          n("persons", "Unemployed Persons", "us-unemployed-persons"),
          n("long-term", "Long-Term Unemployed", "us-long-term-unemployed"),
          n("u6", "U-6 Underemployment Rate", "us-u6"),
        ],
      },
      {
  id: "us-payrolls-card", metricId: "us-payrolls-level", title: "Nonfarm Payroll Employment",
  components: [
    n("total", "Total Nonfarm Payrolls", "us-payrolls-level"),
    n("private", "Private Employment", "us-private-payrolls"),
    n("government", "Government Employment", "us-government-payrolls"),
    n("change", "3-Month Average Change", "us-nfp"),
  ],
},
      {
        id: "us-participation-card", metricId: "us-participation", title: "Labor Force Participation",
        components: [
          n("participation", "Participation Rate", "us-participation"),
          n("epop", "Employment-Population Ratio", "us-employment-population"),
          n("labor-force", "Civilian Labor Force", "us-civilian-labor-force"),
          n("not-in-lf", "Not in Labor Force", "us-not-in-labor-force"),
        ],
      },
      {
        id: "us-jolts-card", metricId: "us-jolts-openings", title: "Job Openings & Labor Turnover",
        components: [
          n("openings", "Job Openings", "us-jolts-openings"),
          n("hires", "Hires", "us-jolts-hires-level"),
          n("quits", "Quits", "us-jolts-quits-level"),
          n("layoffs", "Layoffs & Discharges", "us-jolts-layoffs-level"),
          n("separations", "Total Separations", "us-jolts-total-separations"),
        ],
      },
      {
  id: "us-wages-card",
  metricId: "us-ahe",
  momMetricId: "us-ahe-mom",
  title: "Wage Growth",
  components: [
    n("hourly", "Average Hourly Earnings", "us-ahe"),
    n("weekly", "Average Weekly Earnings", "us-average-weekly-earnings"),
    n("hours", "Average Weekly Hours", "us-avg-workweek"),
  ],
},
      {
        id: "us-claims-card", metricId: "us-initial-claims", title: "Jobless Claims",
        components: [
          n("initial", "Initial Jobless Claims", "us-initial-claims"),
          n("continuing", "Continuing Jobless Claims", "us-continuing-claims"),
        ],
      },
    ],
  },

  UK: {
    inflation: [
      {
        id: "uk-cpi-card", metricId: "uk-cpi-yoy", yoyMetricId: "uk-cpi-yoy", momMetricId: "uk-cpi-mom", title: "CPI",
        components: [
  n("01", "01 · Food & non-alcoholic beverages", "uk-food-cpi-yoy"),
  n("02", "02 · Alcohol & tobacco", "uk-alcohol-cpi-yoy"),
  n("03", "03 · Clothing & footwear", "uk-clothing-cpi-yoy"),
  n("04", "04 · Housing & household services", "uk-housing-cpi-yoy"),
  n("05", "05 · Furniture & household goods", "uk-furniture-cpi-yoy"),
  n("06", "06 · Health", "uk-health-cpi-yoy"),
  n("07", "07 · Transport", "uk-transport-cpi-yoy"),
  n("08", "08 · Communication", "uk-communication-cpi-yoy"),
  n("09", "09 · Recreation & culture", "uk-recreation-cpi-yoy"),
  n("10", "10 · Education", "uk-education-cpi-yoy"),
  n("11", "11 · Restaurants & hotels", "uk-restaurants-hotels-cpi-yoy"),
  n("12", "12 · Miscellaneous goods & services", "uk-miscellaneous-cpi-yoy"),
],
      },
      {
        id: "uk-cpih-card", metricId: "uk-cpih-yoy", yoyMetricId: "uk-cpih-yoy", momMetricId: "uk-cpih-mom", title: "CPIH",
        components: [
  n("01", "01 · Food & non-alcoholic beverages", "uk-food-cpih-yoy"),
  n("02", "02 · Alcohol & tobacco", "uk-alcohol-cpih-yoy"),
  n("03", "03 · Clothing & footwear", "uk-clothing-cpih-yoy"),
  n("04", "04 · Housing & household services", "uk-housing-cpih-yoy"),
  n("05", "05 · Furniture & household goods", "uk-furniture-cpih-yoy"),
  n("06", "06 · Health", "uk-health-cpih-yoy"),
  n("07", "07 · Transport", "uk-transport-cpih-yoy"),
  n("08", "08 · Communication", "uk-communication-cpih-yoy"),
  n("09", "09 · Recreation & culture", "uk-recreation-cpih-yoy"),
  n("10", "10 · Education", "uk-education-cpih-yoy"),
  n("11", "11 · Restaurants & hotels", "uk-restaurants-hotels-cpih-yoy"),
  n("12", "12 · Miscellaneous goods & services", "uk-miscellaneous-cpih-yoy"),
],
      },
      {
        id: "uk-core-card", metricId: "uk-core-cpi-yoy", yoyMetricId: "uk-core-cpi-yoy", momMetricId: "uk-core-cpi-mom", title: "Core Inflation",
        components: [
          n("core-cpi", "Core CPI", "uk-core-cpi-yoy"),
          n("core-cpih", "Core CPIH", "uk-core-cpih-yoy"),
        ],
      },
      {
        id: "uk-goods-card", metricId: "uk-goods-cpi-yoy", yoyMetricId: "uk-goods-cpi-yoy", momMetricId: "uk-goods-cpi-mom", title: "Goods Inflation",
        components: [
          n("cpi-goods", "CPI Goods", "uk-goods-cpi-yoy"),
          n("food", "Food & non-alcoholic beverages", "uk-food-cpi-yoy"),
          n("energy", "Energy", "uk-energy-cpi-yoy"),
          n("clothing", "Clothing & footwear"),
        ],
      },
      {
        id: "uk-services-card", metricId: "uk-services-cpi-yoy", yoyMetricId: "uk-services-cpi-yoy", momMetricId: "uk-services-cpi-mom", title: "Services Inflation",
        components: [
          n("cpi-services", "CPI Services", "uk-services-cpi-yoy"),
          n("housing", "Housing & household services", "uk-housing-cpi-yoy"),
          n("transport", "Transport"),
          n("communication", "Communication"),
          n("recreation", "Recreation & culture"),
          n("restaurants", "Restaurants & hotels"),
        ],
      },
      {
        id: "uk-food-card", metricId: "uk-food-cpi-yoy", yoyMetricId: "uk-food-cpi-yoy", momMetricId: "uk-food-cpi-mom", title: "Food Inflation",
        components: [
          n("food-cpi", "Food & non-alcoholic beverages — CPI", "uk-food-cpi-yoy"),
          n("food-cpih", "Food & non-alcoholic beverages — CPIH", "uk-food-cpih-yoy"),
        ],
      },
      {
        id: "uk-housing-card", metricId: "uk-housing-cpi-yoy", yoyMetricId: "uk-housing-cpi-yoy", momMetricId: "uk-housing-cpih-mom", title: "Housing & Household Services",
        components: [
          n("housing-cpih", "Housing & household services — CPIH", "uk-housing-cpih-yoy"),
          n("housing-cpi", "Housing & household services — CPI", "uk-housing-cpi-yoy"),
          n("electricity-gas", "Electricity, gas & other fuels", "uk-energy-cpi-yoy"),
          n("ooh", "Owner-occupiers' housing costs"),
        ],
      },
      // ----------------------------------------------------
// UK INFLATION EXPECTATIONS
// ----------------------------------------------------
{
  id: "uk-inflation-expectations-consumer",
  metricId: "uk-inflation-exp-1y",
  title: "Consumer Expectations",
  components: [
    n(
      "ias-1y",
      "BoE Inflation Attitudes Survey — 1-Year",
      "uk-inflation-exp-1y"
    ),
    n(
      "ias-2y",
      "BoE Inflation Attitudes Survey — 2-Year",
      "uk-inflation-exp-2y"
    ),
    n(
      "ias-5y",
      "BoE Inflation Attitudes Survey — 5-Year",
      "uk-inflation-exp-5y"
    ),
    n(
      "citi-yougov-1y",
      "Citi/YouGov — 1-Year",
      "uk-citi-yougov-inflation-exp-1y"
    ),
    n(
      "citi-yougov-5-10y",
      "Citi/YouGov — 5–10-Year",
      "uk-citi-yougov-inflation-exp-5-10y"
    ),
  ],
  chartMetricIds: [
    "uk-inflation-exp-1y",
    "uk-inflation-exp-2y",
    "uk-inflation-exp-5y",
    "uk-citi-yougov-inflation-exp-1y",
    "uk-citi-yougov-inflation-exp-5-10y",
  ],
},

{
  id: "uk-inflation-expectations-business",
  metricId: "uk-dmp-inflation-exp-1y",
  title: "Business Expectations",
  components: [
    n(
      "dmp-1y",
      "BoE Decision Maker Panel — CPI 1-Year",
      "uk-dmp-inflation-exp-1y"
    ),
    n(
      "dmp-3y",
      "BoE Decision Maker Panel — CPI 3-Year",
      "uk-dmp-inflation-exp-3y"
    ),
    n(
      "dmp-own-price",
      "BoE DMP — Own-Price Inflation 1-Year",
      "uk-dmp-own-price-exp-1y"
    ),
  ],
  chartMetricIds: [
    "uk-dmp-inflation-exp-1y",
    "uk-dmp-inflation-exp-3y",
    "uk-dmp-own-price-exp-1y",
  ],
},
{
  id: "uk-inflation-expectations-wage",
  metricId: "uk-dmp-wage-exp-1y",
  title: "Wage Expectations",
  components: [
    n(
      "dmp-wage",
      "BoE DMP — Wage Growth 1-Year",
      "uk-dmp-wage-exp-1y"
    ),
  ],
  chartMetricIds: [
    "uk-dmp-wage-exp-1y",
  ],
},

{
  id: "uk-inflation-expectations-market",
  metricId: "uk-inflation-comp-1y",
  title: "Market-Based",
  components: [
    n(
      "uk-market-1y",
      "UK Inflation Compensation — 1-Year",
      "uk-inflation-comp-1y"
    ),
    n(
      "uk-market-5y5y",
      "UK Inflation Compensation — 5Y5Y",
      "uk-inflation-comp-5y5y"
    ),
  ],
  chartMetricIds: [
    "uk-inflation-comp-1y",
    "uk-inflation-comp-5y5y",
  ],
},

{
  id: "uk-inflation-expectations-professional",
  metricId: "uk-maps-inflation-1y",
  title: "Professional Expectations",
  components: [
    n(
      "maps-1y",
      "BoE Market Participants Survey — 1-Year",
      "uk-maps-inflation-1y"
    ),
    n(
      "maps-2y",
      "BoE Market Participants Survey — 2-Year",
      "uk-maps-inflation-2y"
    ),
    n(
      "maps-3y",
      "BoE Market Participants Survey — 3-Year",
      "uk-maps-inflation-3y"
    ),
    n(
      "maps-5y",
      "BoE Market Participants Survey — 5-Year",
      "uk-maps-inflation-5y"
    ),
  ],
  chartMetricIds: [
    "uk-maps-inflation-1y",
    "uk-maps-inflation-2y",
    "uk-maps-inflation-3y",
    "uk-maps-inflation-5y",
  ],
},


    ],

    growth: [
  {
    id: "uk-gdp-card",
    metricId: "uk-gdp-qoq",
    yoyMetricId: "uk-gdp-yoy",
    momMetricId: "uk-gdp-qoq",
    title: "Real GDP",
    components: [
      n("qoq", "Real GDP QoQ", "uk-gdp-qoq"),
      n("yoy", "Real GDP YoY", "uk-gdp-yoy"),
    ],
  },

  {
    id: "uk-gdp-monthly-card",
    metricId: "uk-gdp-mom",
    title: "GDP",
    components: [
      n("mom", "GDP MoM", "uk-gdp-mom"),
    ],
    chartMetricIds: [
      "uk-gdp-mom",
    ],
  },

  {
    id: "uk-retail-sales-card",
    metricId: "uk-retail-sales-total-ex-fuel",
    title: "Retail Sales",
    components: [
      n("food-stores", "Food Stores", "uk-retail-food-stores"),
      n("non-food-stores", "Non-Food Stores", "uk-retail-non-food-stores"),
      n("non-store", "Non-Store (Online)", "uk-retail-nonstore"),
      n("automotive-fuel", "Automotive Fuel", "uk-retail-automotive-fuel"),
      n("total-ex-fuel", "Total ex Fuel", "uk-retail-sales-total-ex-fuel"),
    ],
  },

  {
    id: "uk-pmi-card",
    metricId: "uk-sp-global-composite-pmi",
    title: "PMI",
    components: [
      n("manufacturing", "S&P Global Manufacturing", "uk-sp-global-manufacturing-pmi"),
      n("services", "S&P Global Services", "uk-sp-global-services-pmi"),
      n("composite", "S&P Global Composite", "uk-sp-global-composite-pmi"),
    ],
  },

  {
  id: "uk-household-card",
  metricId: "uk-household-consumption-level",
  title: "Household Consumption",
  components: [
    n(
      "household",
      "Household Final Consumption",
      "uk-household-consumption-level"
    ),
  ],
},

 {
  id: "uk-capital-card",
  metricId: "uk-gfcf-level",
  yoyMetricId: "uk-gfcf-yoy",
  momMetricId: "uk-gfcf-qoq",
  title: "Gross Fixed Capital Formation",
  components: [
    n(
      "gcf",
      "Gross Fixed Capital Formation",
      "uk-gfcf-level"
    ),
    n(
      "business-investment",
      "Business Investment",
      "uk-business-investment-qoq"
    ),
  ],
},

  {
    id: "uk-government-card",
    metricId: "uk-government-consumption-level",
    title: "Government Consumption",
    components: [
      n(
        "government",
        "Government Final Consumption",
        "uk-government-consumption-level"
      ),
    ],
  },

  {
    id: "uk-net-trade-card",
    metricId: "uk-net-trade-qoq",
    title: "Net Trade Contribution",
    components: [
      n(
        "qoq",
        "Net Trade QoQ Contribution",
        "uk-net-trade-qoq"
      ),
      n(
        "yoy",
        "Net Trade YoY Contribution",
        "uk-net-trade-yoy"
      ),
    ],
  },
],
    jobs: [
      {
        id: "uk-unemployment-card", metricId: "uk-unemployment", title: "Unemployment Rate",
        components: [
          n("rate", "Unemployment Rate", "uk-unemployment"),
          n("persons", "Unemployed Persons"),
          n("long-term", "Long-Term Unemployment"),
        ],
      },
      {
        id: "uk-employment-card", metricId: "uk-employment-level", title: "Employment",
        components: [
          n("level", "Employment Level", "uk-employment-level"),
          n("rate", "Employment Rate", "uk-employment-rate"),
          n("change", "Employment Change", "uk-employment-change"),
          n("employee-jobs", "Employee Jobs"),
        ],
      },
      {
        id: "uk-inactivity-card", metricId: "uk-inactivity-rate", title: "Economic Inactivity",
        components: [
          n("rate", "Inactivity Rate", "uk-inactivity-rate"),
          n("inactive", "Inactive Persons"),
          n("change", "Inactivity Change"),
          n("reasons", "By Reason"),
        ],
      },
      {
        id: "uk-vacancies-card", metricId: "uk-vacancies", title: "Job Vacancies",
        components: [
          n("vacancies", "Total Vacancies", "uk-vacancies"),
          n("rate", "Vacancy Rate"),
          n("change", "Vacancy Change"),
        ],
      },
      {
        id: "uk-wages-card", metricId: "uk-awe-total-yoy", title: "Wage Growth",
        components: [
          n("total", "AWE Total Pay", "uk-awe-total-yoy"),
          n("regular", "AWE Regular Pay", "uk-awe-regular-yoy"),
          n("real-total", "Real AWE Total"),
          n("real-regular", "Real AWE Regular"),
        ],
      },
      {
  id: "uk-payrolled-card",
  metricId: "uk-payrolled-employees-level",
  title: "Payrolled Employment",
  components: [
    n("payrolled", "Payrolled Employees", "uk-payrolled-employees-level"),
    n("monthly", "Monthly Change", "uk-employment-change"),
    n("annual", "Annual Change"),
  ],
},
    ],
  },

  EA: {
    inflation: [
      {
        id: "ea-hicp-card", metricId: "ea-hicp-yoy", yoyMetricId: "ea-hicp-yoy", momMetricId: "ea-hicp-mom", title: "HICP (Headline)",
        components: [
          n("all", "All-items HICP", "ea-hicp-yoy"),
          n("goods", "Non-energy industrial goods", "ea-goods-hicp-yoy"),
          n("services", "Services", "ea-services-hicp-yoy"),
        ],
      },
      {
        id: "ea-core-card", metricId: "ea-core-hicp-yoy", yoyMetricId: "ea-core-hicp-yoy", momMetricId: "ea-core-hicp-mom", title: "Core HICP",
        components: [
          n("ex-energy", "Excluding energy"),
          n("ex-energy-unprocessed", "Excluding energy & unprocessed food"),
          n("ex-energy-food", "Excluding energy, food, alcohol & tobacco", "ea-core-hicp-yoy"),
        ],
      },
      {
        id: "ea-food-card", metricId: "ea-food-hicp-yoy", title: "Food, Alcohol & Tobacco",
        components: [
          n("food", "Food, alcohol & tobacco", "ea-food-hicp-yoy"),
          n("processed", "Processed food, alcohol & tobacco"),
          n("unprocessed", "Unprocessed food"),
        ],
      },
      {
        id: "ea-energy-card", metricId: "ea-energy-hicp-yoy", title: "Energy",
        components: [
          n("energy", "Energy", "ea-energy-hicp-yoy"),
          n("electricity", "Electricity / gas / solid fuels / heat"),
          n("liquid-fuels", "Liquid fuels"),
        ],
      },
      {
        id: "ea-neig-card", metricId: "ea-goods-hicp-yoy", title: "Non-Energy Industrial Goods",
        components: [
          n("neig", "Non-energy industrial goods", "ea-goods-hicp-yoy"),
          n("durable", "Durable goods"),
          n("semi", "Semi-durable goods"),
          n("non-durable", "Non-durable goods"),
        ],
      },
      {
        id: "ea-services-card", metricId: "ea-services-hicp-yoy", yoyMetricId: "ea-services-hicp-yoy", momMetricId: "ea-services-hicp-mom", title: "Services",
        components: [
          n("services", "Services", "ea-services-hicp-yoy"),
          n("communication", "Services related to communication"),
          n("housing", "Services related to housing"),
          n("misc", "Services — miscellaneous"),
          n("recreation", "Services related to recreation & personal care"),
          n("transport", "Services related to transport"),
        ],
      },
      // ----------------------------------------------------
// EURO AREA INFLATION EXPECTATIONS
// ----------------------------------------------------

{
  id: "ea-inflation-expectations-consumer",
  metricId: "ea-ces-inflation-exp-1y",
  title: "Consumer Expectations",
  expectationGroup: "consumer",
  components: [
    n("ces-1y", "ECB CES — 1-Year Inflation Expectations", "ea-ces-inflation-exp-1y"),
    n("ces-3y", "ECB CES — 3-Year Inflation Expectations", "ea-ces-inflation-exp-3y"),
    n("ces-5y", "ECB CES — 5-Year Inflation Expectations", "ea-ces-inflation-exp-5y"),
  ],
  chartMetricIds: [
    "ea-ces-inflation-exp-1y",
    "ea-ces-inflation-exp-3y",
    "ea-ces-inflation-exp-5y",
  ],
},

{
  id: "ea-inflation-expectations-wage",
  metricId: "ea-wage-tracker",
  title: "Wage Expectations",
  expectationGroup: "wage",
  components: [
    n("wage-tracker", "ECB Wage Tracker", "ea-wage-tracker"),
    n("wage-tracker-ex-oneoff", "ECB Wage Tracker — Excluding One-Off Payments", "ea-wage-tracker-ex-oneoff"),
    n("spf-wage-1y", "ECB SPF — Wage / Labour-Cost Assumption 1-Year", "ea-spf-wage-exp-1y"),
  ],
  chartMetricIds: [
    "ea-wage-tracker",
    "ea-wage-tracker-ex-oneoff",
    "ea-spf-wage-exp-1y",
  ],
},

{
  id: "ea-inflation-expectations-business",
  metricId: "ea-safe-selling-price-exp-1y",
  title: "Business Expectations",
  expectationGroup: "business",
  components: [
    n("safe-selling-price-1y", "ECB SAFE — Expected Selling-Price Growth 1-Year", "ea-safe-selling-price-exp-1y"),
    n("safe-input-cost-1y", "ECB SAFE — Expected Non-Labour Input-Cost Growth 1-Year", "ea-safe-input-cost-exp-1y"),
    n("safe-wage-1y", "ECB SAFE — Expected Wage Growth 1-Year", "ea-safe-wage-exp-1y"),
  ],
  chartMetricIds: [
    "ea-safe-selling-price-exp-1y",
    "ea-safe-input-cost-exp-1y",
    "ea-safe-wage-exp-1y",
  ],
},

{
  id: "ea-inflation-expectations-market",
  metricId: "ea-inflation-comp-1y",
  title: "Market-Based Expectations",
  expectationGroup: "market",
  components: [
    n("inflation-comp-1y", "EUR Inflation Compensation — 1-Year", "ea-inflation-comp-1y"),
    n("inflation-comp-2y", "EUR Inflation Compensation — 2-Year", "ea-inflation-comp-2y"),
    n("inflation-comp-5y5y", "EUR Inflation Compensation — 5Y5Y", "ea-inflation-comp-5y5y"),
  ],
  chartMetricIds: [
    "ea-inflation-comp-1y",
    "ea-inflation-comp-2y",
    "ea-inflation-comp-5y5y",
  ],
},

{
  id: "ea-inflation-expectations-professional",
  metricId: "ea-spf-current-year",
  title: "Professional Forecasters",
  expectationGroup: "professional",
  components: [
    n("spf-current-year", "ECB SPF — Current-Year HICP Forecast", "ea-spf-current-year"),
    n("spf-1y", "ECB SPF — 1-Year HICP Forecast", "ea-inflation-exp-1y"),
    n("spf-2y", "ECB SPF — 2-Year HICP Forecast", "ea-spf-hicp-2y"),
    n("spf-lt", "ECB SPF — Long-Term HICP Forecast", "ea-inflation-exp-lt"),
  ],
  chartMetricIds: [
    "ea-spf-current-year",
    "ea-inflation-exp-1y",
    "ea-spf-hicp-2y",
    "ea-inflation-exp-lt",
  ],
},

    ],
    growth: [
      {
        id: "ea-gdp-card", metricId: "ea-gdp-qoq", yoyMetricId: "ea-gdp-yoy", title: "Real GDP",
        components: [n("qoq", "Real GDP QoQ", "ea-gdp-qoq"), n("yoy", "Real GDP YoY", "ea-gdp-yoy")],
      },
      {
  id: "ea-retail-sales-card",
  metricId: "ea-retail-sales-total-ex-motor-vehicles",
  title: "Retail Sales",
  components: [
    n("food-drinks-tobacco", "Food / Drinks / Tobacco", "ea-retail-food-drinks-tobacco"),
    n("non-food-ex-fuel", "Non-Food ex Fuel", "ea-retail-non-food-ex-fuel"),
    n("automotive-fuel", "Automotive Fuel", "ea-retail-automotive-fuel"),
    n("total-ex-motor-vehicles", "Total ex Motor Vehicles", "ea-retail-sales-total-ex-motor-vehicles"),
  ],
},

{
  id: "ea-pmi-card",
  metricId: "ea-sp-global-composite-pmi",
  title: "PMI",
  components: [
    n("manufacturing", "S&P Global Manufacturing", "ea-sp-global-manufacturing-pmi"),
    n("services", "S&P Global Services", "ea-sp-global-services-pmi"),
    n("composite", "S&P Global Composite", "ea-sp-global-composite-pmi"),
  ],
},
      {
        id: "ea-household-card", metricId: "ea-household-consumption", title: "Household Consumption",
        components: [n("household", "Household + NPISH final consumption", "ea-household-consumption")],
      },
      {
        id: "ea-capital-card", metricId: "ea-gfcf", title: "Gross Fixed Capital Formation",
        components: [n("gfcf", "Gross Fixed Capital Formation", "ea-gfcf"), n("inventories", "Change in Inventories"), n("valuables", "Acquisition less disposal of valuables")],
      },
      {
        id: "ea-government-card", metricId: "ea-government-consumption", title: "Government Consumption",
        components: [n("government", "Government Final Consumption", "ea-government-consumption")],
      },
      {
        id: "ea-exports-card", metricId: "ea-exports", title: "Exports",
        components: [n("total", "Total Exports", "ea-exports"), n("goods", "Goods Exports"), n("services", "Services Exports")],
      },
      {
        id: "ea-imports-card", metricId: "ea-imports", title: "Imports / Net Trade",
        components: [n("imports", "Total Imports", "ea-imports"), n("goods", "Goods Imports"), n("services", "Services Imports"), n("net", "Net Exports")],
      },
      
    ],
        jobs: [
      {
        id: "ea-unemployment-card",
        metricId: "ea-unemployment",
        title: "Unemployment Rate",
        components: [
          n("rate", "Unemployment Rate", "ea-unemployment"),
          n("persons", "Unemployed Persons", "ea-unemployed-persons"),
          n("long-term", "Long-Term Unemployment", "ea-long-term-unemployment"),
        ],
      },

      {
        id: "ea-youth-card",
        metricId: "ea-youth-unemployment",
        title: "Youth Unemployment",
        components: [
          n("rate", "Youth Unemployment Rate", "ea-youth-unemployment"),
          n("persons", "Youth Unemployed Persons", "ea-youth-unemployed-persons"),
        ],
      },

      {
        id: "ea-employment-card",
        metricId: "ea-employment-yoy",
        title: "Employment",
        components: [
          n("employment", "Employment YoY", "ea-employment-yoy"),
          n("rate", "Employment Rate", "ea-employment-rate"),
          n("change", "Employment Change", "ea-employment-change"),
        ],
      },

      {
        id: "ea-inactivity-card",
        metricId: "ea-inactivity",
        title: "Economic Inactivity",
        components: [
          n("rate", "Inactivity Rate", "ea-inactivity"),
          n("population", "Inactive Population", "ea-inactive-population"),
          n("change", "Inactivity Change", "ea-inactivity-change"),
        ],
      },

      {
        id: "ea-vacancies-card",
        metricId: "ea-job-vacancies",
        title: "Job Vacancies",
        components: [
          n("rate", "Vacancy Rate", "ea-job-vacancies"),
          n("posts", "Vacant Posts", "ea-vacant-posts"),
          n("change", "Vacancy Change", "ea-vacancy-change"),
        ],
      },

      {
        id: "ea-wages-card",
        metricId: "ea-wage-growth",
        title: "Wage Growth / Labour Costs",
        components: [
          n("yoy", "Wage Growth YoY", "ea-wage-growth"),
          n("qoq", "Wage Growth QoQ", "ea-wage-growth-qoq"),
        ],
      },
    ],
  },
};

export const REGION_LABEL: Record<Region, string> = {
  US: "United States",
  UK: "United Kingdom",
  EA: "Euro Area",
};

export const REGION_FLAG: Record<Region, string> = { US:"🇺🇸", UK:"🇬🇧", EA:"🇪🇺" };

export function flattenMetricIds(nodes: UiNode[] | undefined): string[] {
  if (!nodes) return [];
  const out: string[] = [];
  const walk = (xs: UiNode[]) => xs.forEach(x => {
    if (x.metricId) out.push(x.metricId);
    if (x.children) walk(x.children);
  });
  walk(nodes);
  return [...new Set(out)];
}
