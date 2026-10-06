/** Cross-economy desk matrix row definitions. */

export type ColumnRule = "monthly" | "quarter" | "survey";

export type DeskRegion = "US" | "UK" | "EA";

export const SURVEY_QUARTER_MONTHS = [2, 5, 8, 11] as const;

export interface DeskMatrixRowDef {
  id: string;
  label: string;
  us: string;
  uk: string;
  ea: string;
  columnRule?: ColumnRule;
  columnRuleByRegion?: Partial<Record<DeskRegion, ColumnRule>>;
  surveyMonths?: number[];
  /** When set, emit a single row for this economy only (e.g. EA-only SPF series). */
  onlyRegion?: DeskRegion;
}

export interface DeskMatrixSubblock {
  id: string;
  title: string;
  rows: DeskMatrixRowDef[];
}

export interface DeskMatrixBlock {
  id: string;
  title: string;
  subblocks: DeskMatrixSubblock[];
}

export const DESK_MATRIX_BLOCKS: DeskMatrixBlock[] = [
  {
    id: "inflation",
    title: "Inflation",
    subblocks: [
      {
        id: "headline",
        title: "Headline",
        rows: [
          {
            id: "cpi-yoy",
            label: "CPI YoY",
            us: "us-cpi-yoy",
            uk: "uk-cpi-yoy",
            ea: "ea-hicp-yoy",
          },
        ],
      },
      {
        id: "core",
        title: "Core",
        rows: [
          {
            id: "core-cpi-yoy",
            label: "Core CPI YoY",
            us: "us-core-cpi-yoy",
            uk: "uk-core-cpi-yoy",
            ea: "ea-core-hicp-yoy",
          },
          {
            id: "core-cpi-mom",
            label: "Core CPI MoM",
            us: "us-core-cpi-mom",
            uk: "uk-core-cpi-mom",
            ea: "ea-core-hicp-mom",
          },
        ],
      },
      {
        id: "ppi",
        title: "Producer prices",
        rows: [
          {
            id: "ppi",
            label: "PPI / output prices YoY",
            us: "us-ppi-final-demand",
            uk: "uk-ppi-output-yoy",
            ea: "ea-ppi-yoy",
          },
        ],
      },
      {
        id: "expectations",
        title: "Expectations",
        rows: [
          {
            id: "infl-exp-consumer-1y",
            label: "Consumer inflation 1Y",
            us: "us-umich-inflation-exp-1y",
            uk: "uk-inflation-exp-1y",
            ea: "ea-ces-inflation-exp-1y",
            columnRule: "monthly",
            columnRuleByRegion: { UK: "survey" },
            surveyMonths: [...SURVEY_QUARTER_MONTHS],
          },
          {
            id: "infl-exp-professional-1y",
            label: "Professional / SPF HICP 1Y",
            us: "us-cleveland-exp-inf-1y",
            uk: "uk-inflation-exp-1y",
            ea: "ea-inflation-exp-1y",
            columnRule: "monthly",
            columnRuleByRegion: { UK: "survey", EA: "survey" },
            surveyMonths: [...SURVEY_QUARTER_MONTHS],
          },
          {
            id: "infl-exp-core-spf-1y",
            label: "EA Core SPF 1Y",
            us: "ea-core-inflation-exp-1y",
            uk: "ea-core-inflation-exp-1y",
            ea: "ea-core-inflation-exp-1y",
            onlyRegion: "EA",
            columnRule: "survey",
            surveyMonths: [...SURVEY_QUARTER_MONTHS],
          },
          {
            id: "infl-exp-5y",
            label: "Longer-term / 5Y",
            us: "us-cleveland-exp-inf-5y",
            uk: "uk-inflation-exp-5y",
            ea: "ea-inflation-exp-lt",
            columnRule: "monthly",
            columnRuleByRegion: { UK: "survey", EA: "survey" },
            surveyMonths: [...SURVEY_QUARTER_MONTHS],
          },
          {
            id: "wage-exp-1y",
            label: "Wage growth expectation",
            us: "us-ahe",
            uk: "uk-dmp-wage-exp-1y-3m",
            ea: "ea-safe-wage-exp-1y",
            columnRule: "monthly",
            columnRuleByRegion: { EA: "survey" },
            surveyMonths: [...SURVEY_QUARTER_MONTHS],
          },
        ],
      },
    ],
  },
  {
    id: "growth",
    title: "Growth",
    subblocks: [
      {
        id: "gdp",
        title: "GDP",
        rows: [
          {
            id: "gdp",
            label: "Real GDP",
            us: "us-gdp-real",
            uk: "uk-gdp-qoq",
            ea: "ea-gdp-qoq",
            columnRule: "quarter",
          },
        ],
      },
      {
        id: "activity",
        title: "Activity",
        rows: [
          {
            id: "ip",
            label: "Industrial production",
            us: "us-industrial-production",
            uk: "uk-industrial-production",
            ea: "ea-industrial-production",
          },
          {
            id: "retail",
            label: "Retail sales MoM",
            us: "us-retail-sales",
            uk: "uk-retail-sales-mom",
            ea: "ea-retail-sales-mom",
          },
        ],
      },
    ],
  },
  {
    id: "employment",
    title: "Employment",
    subblocks: [
      {
        id: "unemployment",
        title: "Unemployment",
        rows: [
          {
            id: "unemployment",
            label: "Unemployment rate",
            us: "us-unemployment",
            uk: "uk-unemployment",
            ea: "ea-unemployment",
          },
        ],
      },
      {
        id: "payrolls",
        title: "Payrolls",
        rows: [
          {
            id: "payrolls",
            label: "Employment change",
            us: "us-nfp",
            uk: "uk-employment-change",
            ea: "ea-employment-change",
            columnRule: "monthly",
            columnRuleByRegion: { EA: "quarter" },
          },
        ],
      },
      {
        id: "wages",
        title: "Wages (realized)",
        rows: [
          {
            id: "wages",
            label: "Wage growth",
            us: "us-ahe",
            uk: "uk-awe-regular-yoy",
            ea: "ea-wage-growth",
            columnRule: "monthly",
            columnRuleByRegion: { EA: "quarter" },
          },
        ],
      },
    ],
  },
];

export function allDeskMatrixMetricIds(): string[] {
  const ids = new Set<string>();
  for (const block of DESK_MATRIX_BLOCKS) {
    for (const sub of block.subblocks) {
      for (const row of sub.rows) {
        ids.add(row.us);
        ids.add(row.uk);
        ids.add(row.ea);
      }
    }
  }
  return [...ids];
}

export function quarterMonth(month: number): boolean {
  return month === 3 || month === 6 || month === 9 || month === 12;
}

export function toQuarterEndPeriod(period: string): string {
  const year = period.slice(0, 4);
  const month = Number(period.slice(5, 7));
  if (quarterMonth(month)) return period;
  const end = month <= 3 ? 3 : month <= 6 ? 6 : month <= 9 ? 9 : 12;
  return `${year}-${String(end).padStart(2, "0")}-01`;
}

export function cellAllowed(
  period: string,
  columnRule: ColumnRule = "monthly",
  surveyMonths?: number[]
): boolean {
  const month = Number(period.slice(5, 7));
  if (columnRule === "quarter") return quarterMonth(month);
  if (columnRule === "survey") {
    return surveyMonths?.includes(month) ?? quarterMonth(month);
  }
  return true;
}
