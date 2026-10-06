import type { RawPoint } from "./transforms";

const EUROSTAT_API =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sts_trtu_m";

type EurostatSeriesConfig = {
  nace: string;
  geo: string;
};

const SERIES: Record<string, EurostatSeriesConfig> = {
  "ea-retail-food-drinks-tobacco": {
    nace: "G47_FOOD",
    geo: "EA21",
  },

  "ea-retail-non-food-ex-fuel": {
    nace: "G47_NFOOD_X_G473",
    geo: "EA21",
  },

  "ea-retail-automotive-fuel": {
    nace: "G473",
    geo: "EA21",
  },

  "ea-retail-sales-total-ex-motor-vehicles": {
    nace: "G47",
    geo: "EA21",
  },
};

type EurostatResponse = {
  id?: string[];
  size?: number[];
  dimension?: Record<
    string,
    {
      category?: {
        index?: Record<string, number>;
      };
    }
  >;
  value?: Record<string, number>;
};

function parseDate(value: string): string | null {
  const match = value.match(/^(\d{4})-(\d{2})$/);

  if (!match) {
    return null;
  }

  return `${match[1]}-${match[2]}-01`;
}

function flattenIndex(
  response: EurostatResponse,
  periodIndex: number
): string {
  /*
   * Eurostat JSON-stat stores observations using a flattened
   * multidimensional index. For our query all dimensions except
   * TIME_PERIOD have exactly one selected value.
   *
   * The TIME_PERIOD dimension is therefore the only varying
   * dimension in the flattened observation key.
   */
  return String(periodIndex);
}

export async function fetchEurostatRetailSeries(
  metricId: string
): Promise<RawPoint[]> {
  const config = SERIES[metricId];

  if (!config) {
    throw new Error(
      `No Eurostat retail configuration for metric ${metricId}.`
    );
  }

  const params = new URLSearchParams({
    format: "JSON",
    lang: "en",
    freq: "M",
    indic_bt: "VOL_SLS",
    nace_r2: config.nace,
    s_adj: "SCA",
    unit: "I21",
    geo: config.geo,
  });

  const response = await fetch(`${EUROSTAT_API}?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "MacroHub/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Eurostat retail API failed for ${metricId}: ` +
        `${response.status} ${response.statusText}`
    );
  }

  const json = (await response.json()) as EurostatResponse;

  const periods =
    json.dimension?.time?.category?.index ?? {};

  const values = json.value ?? {};

  const orderedPeriods = Object.entries(periods).sort(
    ([, a], [, b]) => a - b
  );

  const points: RawPoint[] = [];

  for (const [period, periodIndex] of orderedPeriods) {
    const date = parseDate(period);

    if (!date) {
      continue;
    }

    const flattenedIndex = flattenIndex(json, periodIndex);
    const value = values[flattenedIndex];

    if (!Number.isFinite(value)) {
      continue;
    }

   points.push({
  date,
  value,
});
  }

  return points;
}

export function isEurostatRetailMetric(metricId: string): boolean {
  return metricId in SERIES;
}