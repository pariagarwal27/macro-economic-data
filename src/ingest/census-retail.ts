import type { RawPoint } from "./transforms";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
const CENSUS_API =
  "https://api.census.gov/data/timeseries/eits/marts";

type CensusRow = string[];

const SERIES: Record<string, string> = {
  "us-retail-motor-vehicles": "441",
  "us-retail-gasoline": "447",
  "us-retail-food-beverage": "445",
  "us-retail-general-merchandise": "452",
  "us-retail-nonstore": "454",
  "us-retail-food-services": "722",

  // Retail & Food Services total
  "us-retail-sales-total": "44X72",

  // Retail & Food Services ex motor vehicles and gasoline
  "us-retail-total-ex-auto-gas": "44W72",
};

function censusApiKey(): string {
  const key = process.env.CENSUS_API_KEY?.trim();

  if (!key) {
    throw new Error(
      "CENSUS_API_KEY is required for Census MARTS API access."
    );
  }

  return key;
}

function normalizeDate(year: string, month: string): string {
  return `${year}-${month.padStart(2, "0")}-01`;
}

async function fetchCategory(
  categoryCode: string,
  startYear = 2020
): Promise<RawPoint[]> {
  const apiKey = censusApiKey();
  const currentYear = new Date().getUTCFullYear();
  const currentMonth = String(new Date().getUTCMonth() + 1).padStart(2, "0");

  const params = new URLSearchParams({
    get: "cell_value,time_slot_id,time_slot_date,error_data",
    category_code: categoryCode,
    seasonally_adj: "yes",
    data_type_code: "SM",
    time_slot_id: "0",
    time: `from ${startYear}-01 to ${currentYear}-${currentMonth}`,
    key: apiKey,
  });

  const url = `${CENSUS_API}?${params.toString()}`;

  let response: Response | null = null;

for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "MacroHub/1.0",
      },
    });

    if (response.ok) break;
  } catch (error) {
    if (attempt === 3) throw error;
  }

  await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
}

if (!response) {
  throw new Error(`Census MARTS request failed for ${categoryCode}`);
}

  if (!response.ok) {
    throw new Error(
      `Census MARTS API failed for ${categoryCode}: ` +
        `${response.status} ${response.statusText}`
    );
  }

  const json = (await response.json()) as CensusRow[];

  if (!Array.isArray(json) || json.length < 2) {
    return [];
  }

  const headers = json[0];

  const valueIndex = headers.indexOf("cell_value");
  const timeIndex = headers.indexOf("time_slot_date");

  if (valueIndex < 0 || timeIndex < 0) {
    throw new Error(
      `Unexpected Census MARTS response for category ${categoryCode}.`
    );
  }

  const points: RawPoint[] = [];

  for (const row of json.slice(1)) {
    const valueText = row[valueIndex];
    const slot = row[timeIndex];

    if (!valueText || valueText === "(S)" || valueText === "NA") {
      continue;
    }

    const value = Number(valueText);

    if (!Number.isFinite(value)) {
      continue;
    }

    const match = String(slot).match(/^(\d{4})-(\d{2})-\d{2}/);

    if (match) {
      points.push({
        date: normalizeDate(match[1], match[2]),
        value,
      });
      continue;
    }

    const fallback = String(slot).match(/^(\d{4})(\d{2})$/);

    if (fallback) {
      points.push({
        date: normalizeDate(fallback[1], fallback[2]),
        value,
      });
    }
  }

  const deduped = new Map<string, RawPoint>();

  for (const point of points) {
    deduped.set(point.date, point);
  }

  return [...deduped.values()].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}
export async function fetchCensusRetailSeries(
  metricId: string
): Promise<RawPoint[]> {
  const categoryCode = SERIES[metricId];

  if (!categoryCode) {
    throw new Error(
      `No Census MARTS category configured for metric ${metricId}.`
    );
  }

  return fetchCategory(categoryCode);
}

export function isCensusRetailMetric(metricId: string): boolean {
  return metricId in SERIES;
}