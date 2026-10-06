/**
 * Map Investing.com calendar event titles → catalog metric ids.
 * Strict transform matching (YoY / MoM / QoQ) so index & MoM prints do not land on YoY series.
 * First match wins — more specific patterns first.
 */

export type CalendarCountry =
  | "US"
  | "UK"
  | "EA"
  | "DE"
  | "FR"
  | "IT"
  | "ES"
  | "AU"
  | "OTHER";

export interface InvestingEventRule {
  metricId: string;
  currencies: string[];
  countries?: string[];
  /** Matched against normalizeEventName(event). */
  pattern: RegExp;
  /** Reject if this matches (regional CPI, private payrolls, etc.). */
  reject?: RegExp;
}

const YOY = /\b(yoy|year over year|year ago)\b/;
const MOM = /\b(mom|month over month)\b/;
const QOQ = /\b(qoq|quarter over quarter)\b/;

/** Regional / non-national DE prints — never map to de-cpi-yoy. */
const DE_REGIONAL =
  /\b(baden|bavaria|brandenburg|hesse|saxony|rhine|wuerttemberg|württemberg|westphalia|nrw)\b/;

export const INVESTING_EVENT_RULES: InvestingEventRule[] = [
  // ─── US inflation ───────────────────────────────────────────
  {
    metricId: "us-core-cpi-yoy",
    currencies: ["USD"],
    pattern: /\bcore\b.*\bcpi\b.*\byoy\b|\bcpi\b.*\bcore\b.*\byoy\b/,
    reject: MOM,
  },
  {
    metricId: "us-core-cpi-mom",
    currencies: ["USD"],
    pattern: /\bcore\b.*\bcpi\b.*\bmom\b|\bcpi\b.*\bcore\b.*\bmom\b/,
    reject: YOY,
  },
  {
    metricId: "us-cpi-yoy",
    currencies: ["USD"],
    pattern: /\bcpi\b.*\byoy\b|consumer price index.*\byoy\b/,
    reject: /\bcore\b|\bmom\b|\bservices\b|\bshelter\b|\bfood\b|\benergy\b|\bgoods\b/,
  },
  {
    metricId: "us-cpi-mom",
    currencies: ["USD"],
    pattern: /\bcpi\b.*\bmom\b|consumer price index.*\bmom\b/,
    reject: /\bcore\b|\byoy\b|\bservices\b|\bshelter\b|\bfood\b|\benergy\b|\bgoods\b/,
  },
  {
    metricId: "us-services-cpi-yoy",
    currencies: ["USD"],
    pattern: /\bservices\b.*\bcpi\b.*\byoy\b|\bcpi\b.*\bservices\b.*\byoy\b/,
    reject: MOM,
  },
  {
    metricId: "us-services-cpi-mom",
    currencies: ["USD"],
    pattern: /\bservices\b.*\bcpi\b.*\bmom\b|\bcpi\b.*\bservices\b.*\bmom\b/,
    reject: YOY,
  },
  {
    metricId: "us-shelter-cpi-yoy",
    currencies: ["USD"],
    pattern: /\bshelter\b.*\byoy\b|\bcpi\b.*\bshelter\b.*\byoy\b/,
    reject: MOM,
  },
  {
    metricId: "us-shelter-cpi-mom",
    currencies: ["USD"],
    pattern: /\bshelter\b.*\bmom\b|\bcpi\b.*\bshelter\b.*\bmom\b/,
    reject: YOY,
  },
  {
    metricId: "us-core-goods-cpi-yoy",
    currencies: ["USD"],
    pattern: /\bcore\b.*\bgoods\b.*\byoy\b|\bgoods\b.*\bcore\b.*\byoy\b/,
    reject: MOM,
  },
  {
    metricId: "us-food-cpi-yoy",
    currencies: ["USD"],
    pattern: /\bfood\b.*\bcpi\b.*\byoy\b|\bcpi\b.*\bfood\b.*\byoy\b/,
    reject: MOM,
  },
  {
    metricId: "us-energy-cpi-yoy",
    currencies: ["USD"],
    pattern: /\benergy\b.*\bcpi\b.*\byoy\b|\bcpi\b.*\benergy\b.*\byoy\b/,
    reject: MOM,
  },
  {
    metricId: "us-core-pce",
    currencies: ["USD"],
    pattern: /\bcore\b.*\bpce\b.*\byoy\b|\bpce\b.*\bcore\b.*\byoy\b|core pce price.*yoy/,
    reject: /\bmom\b/,
  },
  {
    metricId: "us-core-pce-mom",
    currencies: ["USD"],
    pattern: /\bcore\b.*\bpce\b.*\bmom\b|\bpce\b.*\bcore\b.*\bmom\b/,
    reject: /\byoy\b/,
  },
  {
    metricId: "us-pce",
    currencies: ["USD"],
    pattern: /\bpce\b.*\byoy\b|personal consumption.*\byoy\b/,
    reject: /\bcore\b/,
  },
  {
    metricId: "us-ppi-core",
    currencies: ["USD"],
    pattern: /\bcore\b.*\bppi\b.*\byoy\b|\bppi\b.*\bcore\b.*\byoy\b/,
  },
  {
    metricId: "us-ppi-final-demand",
    currencies: ["USD"],
    pattern: /\bppi\b.*\byoy\b|producer price.*\byoy\b/,
    reject: /\bcore\b/,
  },
  { metricId: "us-import-prices", currencies: ["USD"], pattern: /\bimport price/ },

  // ─── US growth ──────────────────────────────────────────────
  {
    metricId: "us-gdp-real",
    currencies: ["USD"],
    pattern: /\bgdp\b.*(qoq|annualized)/,
    reject: /\bgdpnow\b|atlanta/,
  },
  { metricId: "us-gdp-now", currencies: ["USD"], pattern: /\bgdpnow\b|atlanta fed gdp/ },
  {
    metricId: "us-industrial-production",
    currencies: ["USD"],
    pattern: /\bindustrial production\b.*\bmom\b|\bindustrial production\b(?!.*yoy)/,
  },
  { metricId: "us-capacity-utilization", currencies: ["USD"], pattern: /\bcapacity utilization\b/ },
  {
    metricId: "us-retail-sales-ex-auto",
    currencies: ["USD"],
    pattern: /\bretail sales\b.*(ex|excluding).*(auto|autos).*\bmom\b|\bretail sales\b.*(ex|excluding).*(auto|autos)/,
  },
  {
    metricId: "us-retail-sales",
    currencies: ["USD"],
    pattern: /\bretail sales\b.*\bmom\b/,
    reject: /(ex|excluding).*(auto|autos)|control group|ex gas/,
  },
  { metricId: "us-durable-goods", currencies: ["USD"], pattern: /\bdurable goods\b/ },
  { metricId: "us-housing-starts", currencies: ["USD"], pattern: /\bhousing starts\b/ },
  { metricId: "us-building-permits", currencies: ["USD"], pattern: /\bbuilding permits\b/ },
  { metricId: "us-empire-state", currencies: ["USD"], pattern: /\bempire state\b/ },
  {
    metricId: "us-personal-spending",
    currencies: ["USD"],
    pattern: /\bpersonal spending\b|\bpersonal consumption expenditures\b.*\bmom\b/,
  },
  {
    metricId: "us-manufacturers-new-orders",
    currencies: ["USD"],
    pattern: /\bfactory orders\b|manufacturers.? new orders/,
  },

  // ─── US jobs ────────────────────────────────────────────────
  {
    metricId: "us-nfp",
    currencies: ["USD"],
    pattern: /\bnonfarm payrolls\b|\bnon farm payrolls\b/,
    reject: /\bprivate\b|\badp\b|\bgovernment\b/,
  },
  {
    metricId: "us-adp-change",
    currencies: ["USD"],
    pattern: /\badp\b.*(employment|payroll|change|nonfarm)/,
    reject: /\blevel\b/,
  },
  {
    metricId: "us-unemployment",
    currencies: ["USD"],
    pattern: /\bunemployment rate\b/,
    reject: /\bu-?[456]\b|\bunderemployment\b|\bchange\b|\bclaims\b|\byouth\b/,
  },
  { metricId: "us-u6", currencies: ["USD"], pattern: /\bu-?6\b.*unemployment|unemployment.*\bu-?6\b/ },
  {
    metricId: "us-participation",
    currencies: ["USD"],
    pattern: /\bparticipation rate\b|labor force participation/,
  },
  { metricId: "us-jolts-openings", currencies: ["USD"], pattern: /\bjolts\b.*opening|job openings\b/ },
  { metricId: "us-jolts-quits", currencies: ["USD"], pattern: /\bjolts\b.*quit|quits rate\b/ },
  { metricId: "us-jolts-hires", currencies: ["USD"], pattern: /\bjolts\b.*hire|hires\b/ },
  { metricId: "us-jolts-layoffs", currencies: ["USD"], pattern: /\bjolts\b.*layoff|layoffs?\b.*discharges/ },
  {
    metricId: "us-initial-claims",
    currencies: ["USD"],
    pattern: /\binitial jobless claims\b|\binitial claims\b/,
  },
  {
    metricId: "us-continuing-claims",
    currencies: ["USD"],
    pattern: /\bcontinuing (jobless )?claims\b/,
  },
  { metricId: "us-avg-workweek", currencies: ["USD"], pattern: /\baverage weekly hours\b|\baverage workweek\b/ },
  { metricId: "us-ahe", currencies: ["USD"], pattern: /\baverage hourly earnings\b/ },
  { metricId: "us-eci-wages", currencies: ["USD"], pattern: /\beci\b.*wage|employment cost.*wage/ },
  { metricId: "us-eci-total", currencies: ["USD"], pattern: /\bemployment cost index\b|\beci\b/ },

  // ─── UK ─────────────────────────────────────────────────────
  {
    metricId: "uk-core-cpi-yoy",
    currencies: ["GBP"],
    pattern: /\bcore\b.*\bcpi\b.*\byoy\b|\bcpi\b.*\bcore\b.*\byoy\b/,
    reject: MOM,
  },
  {
    metricId: "uk-core-cpi-mom",
    currencies: ["GBP"],
    pattern: /\bcore\b.*\bcpi\b.*\bmom\b|\bcpi\b.*\bcore\b.*\bmom\b/,
    reject: YOY,
  },
  {
    metricId: "uk-cpi-yoy",
    currencies: ["GBP"],
    pattern: /\bcpi\b.*\byoy\b/,
    reject: /\bcore\b|\bcpih\b|\bmom\b|\bservices\b|\bgoods\b/,
  },
  {
    metricId: "uk-cpi-mom",
    currencies: ["GBP"],
    pattern: /\bcpi\b.*\bmom\b/,
    reject: /\bcore\b|\bcpih\b|\byoy\b|\bservices\b|\bgoods\b/,
  },
  {
    metricId: "uk-cpih-yoy",
    currencies: ["GBP"],
    pattern: /\bcpih\b.*\byoy\b/,
    reject: /\bmom\b/,
  },
  {
    metricId: "uk-services-cpi-yoy",
    currencies: ["GBP"],
    pattern: /\bservices\b.*\bcpi\b.*\byoy\b|\bcpi\b.*\bservices\b.*\byoy\b/,
    reject: MOM,
  },
  {
    metricId: "uk-services-cpi-mom",
    currencies: ["GBP"],
    pattern: /\bservices\b.*\bcpi\b.*\bmom\b|\bcpi\b.*\bservices\b.*\bmom\b/,
    reject: YOY,
  },
  {
    metricId: "uk-goods-cpi-yoy",
    currencies: ["GBP"],
    pattern: /\bgoods\b.*\bcpi\b.*\byoy\b|\bcpi\b.*\bgoods\b.*\byoy\b/,
    reject: MOM,
  },
  {
    metricId: "uk-goods-cpi-mom",
    currencies: ["GBP"],
    pattern: /\bgoods\b.*\bcpi\b.*\bmom\b|\bcpi\b.*\bgoods\b.*\bmom\b/,
    reject: YOY,
  },
  {
    metricId: "uk-food-cpi-yoy",
    currencies: ["GBP"],
    pattern: /\bfood\b.*\bcpi\b|\bcpi\b.*\bfood\b/,
    reject: MOM,
  },
  {
    metricId: "uk-energy-cpi-yoy",
    currencies: ["GBP"],
    pattern: /\benergy\b.*\bcpi\b|\bcpi\b.*\benergy\b|\belectricity.*gas.*\bcpi\b/,
    reject: MOM,
  },
  {
    metricId: "uk-housing-cpi-yoy",
    currencies: ["GBP"],
    pattern: /\bhousing\b.*\bcpi\b|\bcpi\b.*\bhousing\b/,
    reject: MOM,
  },
  {
    metricId: "uk-rpi-yoy",
    currencies: ["GBP"],
    pattern: /\brpi\b.*\byoy\b|retail price index.*\byoy\b/,
    reject: MOM,
  },
  {
    metricId: "uk-ppi-output-yoy",
    currencies: ["GBP"],
    pattern: /\b(ppi|producer price).*\boutput\b.*\byoy\b|\boutput\b.*\b(ppi|producer price).*\byoy\b/,
  },
  {
    metricId: "uk-ppi-input-yoy",
    currencies: ["GBP"],
    pattern: /\b(ppi|producer price).*\binput\b.*\byoy\b|\binput\b.*\b(ppi|producer price).*\byoy\b/,
  },
  { metricId: "uk-gdp-yoy", currencies: ["GBP"], pattern: /\bgdp\b.*\byoy\b/, reject: /\bqoq\b|\bmom\b|\b3m\b/ },
  { metricId: "uk-gdp-qoq", currencies: ["GBP"], pattern: /\bgdp\b.*\bqoq\b/, reject: YOY },
  { metricId: "uk-gdp-mom", currencies: ["GBP"], pattern: /\b(monthly )?gdp\b.*\bmom\b|\bgdp\b.*\bmonthly\b/, reject: YOY },
  {
    metricId: "uk-gdp-3m-yoy",
    currencies: ["GBP"],
    pattern: /\bgdp\b.*\b3.?m\b.*\byoy\b|\bmonthly gdp\b.*\byoy\b/,
    reject: MOM,
  },
  {
    metricId: "uk-industrial-production",
    currencies: ["GBP"],
    pattern: /\bindustrial production\b.*\bmom\b|\bindustrial production\b/,
  },
  {
    metricId: "uk-retail-sales",
    currencies: ["GBP"],
    pattern: /\bretail sales\b.*\bmom\b|\bretail sales\b/,
  },
  {
    metricId: "uk-unemployment",
    currencies: ["GBP"],
    pattern: /\bunemployment rate\b/,
    reject: /\bclaimant\b|\bchange\b/,
  },
  {
    metricId: "uk-employment-level",
    currencies: ["GBP"],
    pattern: /\bemployment change\b|\bemployment level\b/,
  },
  {
    metricId: "uk-awe-regular-yoy",
    currencies: ["GBP"],
    pattern: /\baverage earnings.*regular|regular pay\b|awe.*regular/,
  },
  {
    metricId: "uk-awe-total-yoy",
    currencies: ["GBP"],
    pattern: /\baverage (weekly )?earnings\b|\bawe\b/,
    reject: /\bregular\b/,
  },
  { metricId: "uk-vacancies", currencies: ["GBP"], pattern: /\bvacancies\b|job vacancies\b/ },
  {
    metricId: "uk-business-confidence",
    currencies: ["GBP"],
    pattern: /\bcbi\b|business confidence|industrial trends/,
  },

  // ─── Euro area / nationals (YoY only for CPI/HICP catalog tips) ─
  {
    metricId: "ea-core-hicp-yoy",
    currencies: ["EUR"],
    countries: ["EA", "EU", "EZ"],
    pattern: /\bcore\b.*\b(hicp|cpi)\b.*\byoy\b|\b(hicp|cpi)\b.*\bcore\b.*\byoy\b/,
    reject: MOM,
  },
  {
    metricId: "ea-core-hicp-mom",
    currencies: ["EUR"],
    countries: ["EA", "EU", "EZ"],
    pattern: /\bcore\b.*\b(hicp|cpi)\b.*\bmom\b|\b(hicp|cpi)\b.*\bcore\b.*\bmom\b/,
    reject: YOY,
  },
  {
    metricId: "ea-services-hicp-yoy",
    currencies: ["EUR"],
    countries: ["EA", "EU", "EZ"],
    pattern: /\bservices\b.*\b(hicp|cpi)\b.*\byoy\b|\b(hicp|cpi)\b.*\bservices\b.*\byoy\b/,
    reject: MOM,
  },
  {
    metricId: "ea-goods-hicp-yoy",
    currencies: ["EUR"],
    countries: ["EA", "EU", "EZ"],
    pattern: /\bgoods\b.*\b(hicp|cpi)\b.*\byoy\b|\b(hicp|cpi)\b.*\bgoods\b.*\byoy\b/,
    reject: MOM,
  },
  {
    metricId: "ea-food-hicp-yoy",
    currencies: ["EUR"],
    countries: ["EA", "EU", "EZ"],
    pattern: /\bfood\b.*\b(hicp|cpi)\b|\b(hicp|cpi)\b.*\bfood\b/,
    reject: MOM,
  },
  {
    metricId: "ea-energy-hicp-yoy",
    currencies: ["EUR"],
    countries: ["EA", "EU", "EZ"],
    pattern: /\benergy\b.*\b(hicp|cpi)\b|\b(hicp|cpi)\b.*\benergy\b/,
    reject: MOM,
  },
  {
    metricId: "ea-hicp-mom",
    currencies: ["EUR"],
    countries: ["EA", "EU", "EZ"],
    pattern: /\b(hicp|cpi)\b.*\bmom\b/,
    reject: /\bcore\b|\byoy\b|\bservices\b|\bgoods\b/,
  },
  {
    metricId: "ea-hicp-yoy",
    currencies: ["EUR"],
    countries: ["EA", "EU", "EZ"],
    pattern: /\b(hicp|cpi)\b.*\byoy\b/,
    reject: /\bcore\b|\bmom\b|\bservices\b|\bgoods\b|\bfood\b|\benergy\b/,
  },
  {
    metricId: "de-cpi-yoy",
    currencies: ["EUR"],
    countries: ["DE"],
    pattern: /\b(cpi|hicp)\b.*\byoy\b/,
    reject: new RegExp(`${DE_REGIONAL.source}|\\bmom\\b`, "i"),
  },
  {
    metricId: "fr-cpi-yoy",
    currencies: ["EUR"],
    countries: ["FR"],
    pattern: /\b(cpi|hicp|french.*inflation)\b.*\byoy\b/,
    reject: /\bmom\b/,
  },
  {
    metricId: "it-cpi-yoy",
    currencies: ["EUR"],
    countries: ["IT"],
    pattern: /\b(cpi|hicp)\b.*\byoy\b/,
    reject: MOM,
  },
  {
    metricId: "es-cpi-yoy",
    currencies: ["EUR"],
    countries: ["ES"],
    pattern: /\b(cpi|hicp)\b.*\byoy\b/,
    reject: MOM,
  },
  {
    metricId: "ea-ppi-yoy",
    currencies: ["EUR"],
    countries: ["EA", "EU", "EZ"],
    pattern: /\b(ppi|producer price)\b.*\byoy\b/,
  },
  {
    metricId: "ea-gdp-yoy",
    currencies: ["EUR"],
    countries: ["EA", "EU", "EZ"],
    pattern: /\bgdp\b.*\byoy\b/,
    reject: QOQ,
  },
  {
    metricId: "ea-gdp-qoq",
    currencies: ["EUR"],
    countries: ["EA", "EU", "EZ"],
    pattern: /\bgdp\b.*\bqoq\b/,
    reject: YOY,
  },
  {
    metricId: "ea-industrial-production",
    currencies: ["EUR"],
    countries: ["EA", "EU", "EZ"],
    pattern: /\bindustrial production\b/,
  },
  {
    metricId: "ea-retail-sales",
    currencies: ["EUR"],
    countries: ["EA", "EU", "EZ"],
    pattern: /\bretail sales\b/,
  },
  {
    metricId: "ea-esi",
    currencies: ["EUR"],
    countries: ["EA", "EU", "EZ"],
    pattern: /\beconomic sentiment\b|\besi\b/,
  },
  {
    metricId: "ea-business-confidence",
    currencies: ["EUR"],
    countries: ["EA", "EU", "EZ"],
    pattern: /\bindustrial confidence\b|business climate|business confidence/,
  },
  {
    metricId: "ea-unemployment",
    currencies: ["EUR"],
    countries: ["EA", "EU", "EZ"],
    pattern: /\bunemployment rate\b/,
    reject: /\byouth\b/,
  },
  {
    metricId: "de-unemployment",
    currencies: ["EUR"],
    countries: ["DE"],
    pattern: /\bunemployment (rate|change)\b/,
  },
  {
    metricId: "ea-youth-unemployment",
    currencies: ["EUR"],
    countries: ["EA", "EU", "EZ"],
    pattern: /\byouth unemployment\b/,
  },
];

/**
 * Scale Investing numeric print → catalog unit when promoting to releases.
 * Raw calendar_events.actual stays unscaled.
 */
export const INVESTING_TO_CATALOG_SCALE: Record<string, number> = {
  "us-nfp": 0.001,
  "us-initial-claims": 0.001,
  "us-continuing-claims": 0.001,
  "us-adp-change": 0.001,
  "us-jolts-openings": 0.001,
  "us-jolts-hires": 0.001,
  "us-housing-starts": 0.001,
  "us-building-permits": 0.001,
  "us-payrolls-level": 0.001,
};

export function investingToCatalogScale(metricId: string): number {
  return INVESTING_TO_CATALOG_SCALE[metricId] ?? 1;
}

const CURRENCY_TO_COUNTRY: Record<string, CalendarCountry> = {
  USD: "US",
  GBP: "UK",
  EUR: "EA",
  AUD: "AU",
};

export function normalizeCalendarCountry(
  currency?: string | null,
  countryHint?: string | null
): CalendarCountry {
  const c = (countryHint || "").toUpperCase().trim();
  if (c === "US" || c === "USA" || c === "UNITED STATES") return "US";
  if (c === "UK" || c === "GB" || c === "GBR" || c === "UNITED KINGDOM") return "UK";
  if (c === "DE" || c === "GER" || c === "GERMANY") return "DE";
  if (c === "FR" || c === "FRA" || c === "FRANCE") return "FR";
  if (c === "IT" || c === "ITA" || c === "ITALY") return "IT";
  if (c === "ES" || c === "ESP" || c === "SPAIN") return "ES";
  if (c === "AU" || c === "AUS" || c === "AUSTRALIA") return "AU";
  if (c === "EA" || c === "EU" || c === "EZ" || c === "EMU" || c === "EUROZONE" || c === "EURO AREA")
    return "EA";

  const cur = (currency || "").toUpperCase().trim();
  return CURRENCY_TO_COUNTRY[cur] ?? "OTHER";
}

export function normalizeEventName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[()[\]]/g, " ")
    .replace(/[%€£$]/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function mapInvestingEvent(opts: {
  eventName: string;
  currency?: string | null;
  country?: string | null;
}): string | null {
  const currency = (opts.currency || "").toUpperCase().trim();
  const country = normalizeCalendarCountry(opts.currency, opts.country);
  const name = normalizeEventName(opts.eventName);

  for (const rule of INVESTING_EVENT_RULES) {
    if (currency && !rule.currencies.includes(currency)) continue;
    if (rule.countries?.length) {
      const allowed = new Set(rule.countries.map((x) => x.toUpperCase()));
      const aliases =
        country === "US"
          ? ["US", "USA"]
          : country === "UK"
            ? ["UK", "GB", "GBR"]
            : country === "EA"
              ? ["EA", "EU", "EZ", "EMU"]
              : [country];
      if (!aliases.some((a) => allowed.has(a))) continue;
    }
    if (rule.reject?.test(name)) continue;
    if (rule.pattern.test(name)) return rule.metricId;
  }
  return null;
}

export function detectTransformHint(eventName: string): "yoy" | "mom" | "qoq" | null {
  const n = normalizeEventName(eventName);
  if (YOY.test(n)) return "yoy";
  if (MOM.test(n)) return "mom";
  if (QOQ.test(n)) return "qoq";
  return null;
}
