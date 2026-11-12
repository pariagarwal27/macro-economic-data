import * as XLSX from "xlsx";
import type { RawPoint } from "./transforms";
import { isFreshReleaseFetch } from "./release-fetch-context";

export const SPF_AGGREGATES_URL = "https://www.ecb.europa.eu/stats/prices/indic/forecast/shared/files/data_aggregates_publication.xlsx";
export const SPF_WAGES_URL = "https://data-api.ecb.europa.eu/service/data/SPF/Q.U2.ASSU.LAB..Q.AVG?format=csvdata";
const components = { HICP: "HICP", CORE: "HICPX", GDP: "RGDP", UNEMP: "UNEM" };
const horizons = { CURRENT: "0_AHEAD", NEXT: "1_AHEAD", TWO_YEARS: "2_AHEAD", LT: "LONG_TERM" };
let cache: { expires: number; promise: Promise<Record<string, RawPoint[]>> } | undefined;

export function parseSpfRollingWorkbook(bytes: ArrayBuffer): Record<string, RawPoint[]> {
  const book = XLSX.read(bytes, { type: "array" });
  const output: Record<string, RawPoint[]> = {};
  for (const [component, prefix] of Object.entries(components)) {
    for (const [horizon, suffix] of Object.entries(horizons)) {
      const sheet = book.Sheets[`${prefix}_A_YEAR_${suffix}`];
      if (!sheet) throw new Error(`ECB SPF missing ${prefix} ${suffix} worksheet`);
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
      const points: RawPoint[] = [];
      for (const row of rows) {
        const round = String(row[2] ?? "").match(/^(\d{4})Q([1-4])$/);
        if (!round || row[4] == null || row[4] === "" || !Number.isFinite(Number(row[4]))) continue;
        const target = Number(row[3]);
        const offset = horizon === "CURRENT" ? 0 : horizon === "NEXT" ? 1 : 2;
        if (horizon !== "LT" && target !== Number(round[1]) + offset) continue;
        points.push({ date: `${round[1]}-${String((Number(round[2]) - 1) * 3 + 1).padStart(2, "0")}-01`, value: Number(Number(row[4]).toFixed(1)) });
      }
      output[`SPF_${component}_ROLLING_${horizon}`] = points;
    }
  }
  return output;
}

export function parseSpfRollingWages(csv: string): Record<string, RawPoint[]> {
  const output: Record<string, RawPoint[]> = Object.fromEntries(Object.keys(horizons).map(h => [`SPF_WAGE_ROLLING_${h}`, []]));
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0]!.replace(/^\uFEFF/, "").split(",");
  const index = (name: string) => header.indexOf(name);
  if (["KEY", "TIME_PERIOD", "OBS_VALUE"].some(name => index(name) < 0)) throw new Error("ECB SPF wage CSV missing required fields");
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const key = cells[index("KEY")]?.split(".");
    const round = cells[index("TIME_PERIOD")]?.match(/^(\d{4})-Q([1-4])$/);
    const raw = cells[index("OBS_VALUE")];
    if (!round || !key || !raw?.trim() || !Number.isFinite(Number(raw))) continue;
    const target = key[5];
    const offset = Number(target) - Number(round[1]);
    const horizon = target === "LT" ? "LT" : offset === 0 ? "CURRENT" : offset === 1 ? "NEXT" : offset === 2 ? "TWO_YEARS" : null;
    if (!horizon) continue; // Do not mix older long-term forecasts into short horizons.
    output[`SPF_WAGE_ROLLING_${horizon}`]!.push({ date: `${round[1]}-${String((Number(round[2]) - 1) * 3 + 1).padStart(2, "0")}-01`, value: Number(Number(raw).toFixed(1)) });
  }
  return output;
}

async function loadRollingHistory() {
  const options: RequestInit = isFreshReleaseFetch() ? { cache: "no-store", headers: { "Cache-Control": "no-cache" } } : {};
  const [workbook, wages] = await Promise.all([fetch(SPF_AGGREGATES_URL, options), fetch(SPF_WAGES_URL, options)]);
  if (!workbook.ok || !wages.ok) throw new Error(`ECB rolling SPF source failed: workbook ${workbook.status}, wages ${wages.status}`);
  return { ...parseSpfRollingWorkbook(await workbook.arrayBuffer()), ...parseSpfRollingWages(await wages.text()) };
}

export async function fetchEcbSpfRollingHistory(series: string): Promise<RawPoint[]> {
  if (!/^SPF_(HICP|CORE|GDP|UNEMP|WAGE)_ROLLING_(CURRENT|NEXT|TWO_YEARS|LT)$/.test(series)) throw new Error(`Invalid rolling SPF series: ${series}`);
  const fresh = isFreshReleaseFetch();
  if (!fresh && (!cache || cache.expires <= Date.now())) cache = { expires: Date.now() + 300_000, promise: loadRollingHistory() };
  const points = (await (fresh ? loadRollingHistory() : cache!.promise))[series];
  if (!points?.length) throw new Error(`ECB returned no quarterly observations for ${series}`);
  return [...points].sort((a, b) => a.date.localeCompare(b.date));
}
