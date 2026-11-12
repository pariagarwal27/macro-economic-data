import type { RawPoint } from "./transforms";
import { load } from "cheerio";
import * as XLSX from "xlsx";

const BASE = "https://data-api.ecb.europa.eu/service/data";

export type EcbSpfSeries =
  // HICP inflation expectations
  | "SPF_HICP_CURRENT_YEAR"
  | "SPF_HICP_P12M"
  | "SPF_HICP_P24M"
  | "SPF_HICP_LT"
  | "SPF_HICP_TARGET_2026"
  | "SPF_HICP_TARGET_2027"
  | "SPF_HICP_TARGET_2028"
  | "SPF_HICP_TARGET_LT"
  | `SPF_${"CORE" | "GDP" | "UNEMP" | "WAGE"}_TARGET_${"2026" | "2027" | "2028" | "LT"}`

  // Existing core inflation series
  | "SPF_CORE_P12M"

  // Existing wage/labour-cost assumption
  | "SPF_ASSU_LAB_P12M"
  | "SPF_ASSU_LAB_LT";

const SPF_PATHS: Partial<Record<EcbSpfSeries, string>> = {
  /*
   * IMPORTANT:
   *
   * The ECB SPF calendar-year forecasts are stored using
   * different PxxM horizons depending on the survey round.
   *
   * P9M is the annual series used for the relevant calendar-year
   * horizon. We keep it here because your application already
   * treats this as the "current-year" SPF component.
   *
   * See the ECB SPF horizon documentation for the calendar-year
   * horizon structure.
   */
  SPF_HICP_CURRENT_YEAR:
    "SPF.A.U2.HICP.POINT.P9M.Q.AVG",

  /*
   * HICP inflation forecast 12 months ahead.
   *
   * Official ECB series:
   * SPF.M.U2.HICP.POINT.P12M.Q.AVG
   */
  SPF_HICP_P12M:
    "SPF.M.U2.HICP.POINT.P12M.Q.AVG",

  /*
   * HICP inflation forecast 24 months ahead.
   *
   * IMPORTANT:
   * Use P24M for the 2-year component.
   *
   * Do NOT use the old P21M series here.
   */
  SPF_HICP_P24M:
    "SPF.M.U2.HICP.POINT.P24M.Q.AVG",

  /*
   * ECB SPF long-term HICP inflation expectation.
   */
  SPF_HICP_LT:
    "SPF.Q.U2.HICP.POINT.LT.Q.AVG",

  /*
   * Existing core inflation 12-month forecast.
   */
  SPF_CORE_P12M:
    "SPF.M.U2.CORE.POINT.P12M.Q.AVG",

  /*
   * Existing labour-cost / wage assumption.
   */
  SPF_ASSU_LAB_P12M:
    "SPF.A.U2.ASSU.LAB.P12M.Q.AVG",

  /*
   * Historical quarterly long-term labour-cost growth assumption. The ECB's
   * compensation-per-employee forecast annex starts in 2025 Q3; this official
   * SPF series supplies the earlier long-term wage-growth history. Its values
   * match the annex at the annex's published one-decimal precision over the
   * overlapping quarters.
   */
  SPF_ASSU_LAB_LT:
    "SPF.Q.U2.ASSU.LAB.LT.Q.AVG",
};

const SPF_ARCHIVE_URL = "https://www.ecb.europa.eu/stats/ecb_surveys/survey_of_professional_forecasters/html/all_data.en.html";
let calendarYearHistoryCache: { expiresAt: number; promise: Promise<Record<string, RawPoint[]>> } | undefined;

/**
 * Read the ECB's official results table for each survey round. Unlike the
 * annual SDMX series, these archived tables preserve each quarterly vintage
 * of the calendar-year forecasts for all five SPF subcomponents.
 */
export async function fetchEcbSpfCalendarYearHistory(series: EcbSpfSeries): Promise<RawPoint[]> {
  if (!/^SPF_(HICP|CORE|GDP|UNEMP|WAGE)_TARGET_(2026|2027|2028|LT)$/.test(series)) {
    throw new Error(`Not a calendar-year SPF result series: ${series}`);
  }
  if (!calendarYearHistoryCache || calendarYearHistoryCache.expiresAt <= Date.now()) {
    calendarYearHistoryCache = { expiresAt: Date.now() + 5 * 60_000, promise: loadCalendarYearHistory() };
  }
  const history = await calendarYearHistoryCache.promise;
  const points = history[series] ?? [];
  if (!points.length) throw new Error(`ECB SPF archive returned no ${series} observations`);
  return points;
}

async function loadCalendarYearHistory(): Promise<Record<string, RawPoint[]>> {
  const response = await fetch(SPF_ARCHIVE_URL, { headers: { Accept: "text/html", "User-Agent": "macro-economy-tracker/1.0" } });
  if (!response.ok) throw new Error(`ECB SPF archive ${response.status} ${response.statusText}`);
  const archive = load(await response.text());
  const rounds = [...new Set(archive("a[href]").toArray().flatMap((element) => {
    const href = archive(element).attr("href") ?? "";
    const match = href.match(/table_3_(\d{4})q([1-4])\.en\.html/i);
    return match ? [`${match[1]}q${match[2]}`] : [];
  }))].sort();
  if (!rounds.length) throw new Error("ECB SPF archive has no quarterly result pages");

  const components = ["HICP", "CORE", "GDP", "UNEMP", "WAGE"] as const;
  const targets = ["2026", "2027", "2028", "LT"] as const;
  const output: Record<string, RawPoint[]> = Object.fromEntries(
    components.flatMap((component) => targets.map((target) => [`SPF_${component}_TARGET_${target}`, []]))
  );
  const origin = new URL(SPF_ARCHIVE_URL);
  for (const round of rounds) {
    const match = round.match(/^(\d{4})q([1-4])$/)!;
    const year = Number(match[1]);
    const quarter = Number(match[2]);
    const url = new URL(`ecb.spf${round}.en.html`, origin).toString();
    const page = await fetch(url, { headers: { Accept: "text/html", "User-Agent": "macro-economy-tracker/1.0" } });
    if (!page.ok) continue;
    const $ = load(await page.text());
    const table = $("table").toArray().find((element) => {
      const text = $(element).text().replace(/\s+/g, " ").toLowerCase();
      return text.includes("survey horizon") &&
        (text.includes(`spf q${quarter} ${year}`) || text.includes(`q${quarter} ${year} spf`));
    });
    if (!table) continue;
    const rows = $(table).find("tr").toArray();
    const cellsFor = (row: (typeof rows)[number]) => $(row).find("th,td").toArray().map((cell) => $(cell).text().trim());
    const headerStart = rows.findIndex((row) => cellsFor(row).some((cell) => cell.toLowerCase().includes("survey horizon")));
    const header = rows.slice(Math.max(0, headerStart), Math.max(0, headerStart) + 4).map(cellsFor).find((cells) =>
      cells.some((cell) => /^\d{4}$/.test(cell)) &&
      cells.some((cell) => cell.toLowerCase().includes("longer term"))
    );
    if (!header) continue;
    const date = `${year}-${String((quarter - 1) * 3 + 1).padStart(2, "0")}-01`;
    let component: typeof components[number] | null = null;
    for (const row of rows) {
      const values = cellsFor(row);
      const first = values[0]?.replace(/\s+/g, " ").toLowerCase() ?? "";
      if (first.includes("hicp inflation excluding") || first.includes("hicp excluding energy")) component = "CORE";
      else if (first.includes("hicp inflation")) component = "HICP";
      else if (first.includes("real gdp growth")) component = "GDP";
      else if (first.includes("unemployment rate")) component = "UNEMP";
      else if (first.includes("wage growth")) component = "WAGE";
      if (!component || !/^(?:spf q[1-4] \d{4}|q[1-4] \d{4} spf)$/i.test(first)) continue;
      for (const target of targets) {
        const column = header.findIndex((label) => target === "LT"
          ? label.toLowerCase().includes("longer term")
          : label === target);
        const valueIndex = column + (header.length === values.length ? 0 : 1);
        const raw = column >= 0 ? values[valueIndex] : undefined;
        const value = raw ? Number(raw.replace("%", "")) : NaN;
        if (Number.isFinite(value)) output[`SPF_${component}_TARGET_${target}`]!.push({ date, value });
      }
      component = null;
    }
  }
  // The ECB's detailed round archive goes back further than the press-report
  // pages. Use it to fill earlier quarterly vintages for the four published
  // forecast components; never overwrite a value parsed from the newer SPF
  // comparison table.
  for (const round of rounds) {
    await fillFromDetailedRound(round, origin, output);
  }
  for (const round of rounds.filter((id) => Number(id.slice(0, 4)) >= 2015)) {
    await fillWagesFromAnnex(round, origin, output);
  }
  const firstAnnexWageDate = output.SPF_WAGE_TARGET_LT!
    .map((point) => point.date)
    .sort()[0];
  if (firstAnnexWageDate) {
    const historicalLongTermLabourCosts = await fetchEcbSpfSeries("SPF_ASSU_LAB_LT");
    output.SPF_WAGE_TARGET_LT!.push(
      ...historicalLongTermLabourCosts.filter((point) => point.date < firstAnnexWageDate)
    );
    output.SPF_WAGE_TARGET_LT!.sort((left, right) => left.date.localeCompare(right.date));
  }
  return output;
}

async function fillWagesFromAnnex(round: string, origin: URL, output: Record<string, RawPoint[]>) {
  const match = round.match(/^(\d{4})q([1-4])$/)!;
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  const roundLabel = `q${quarter} ${year}`;
  const url = new URL(`../pdf/ecb.spf_annex${round}.en.xlsx`, origin);
  const response = await fetch(url, { headers: { Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "User-Agent": "macro-economy-tracker/1.0" } });
  if (!response.ok) return;
  const workbook = XLSX.read(await response.arrayBuffer(), { type: "array" });
  const sheet = workbook.Sheets["Chart 13"];
  if (!sheet) return;
  const rows = XLSX.utils.sheet_to_json<Array<string | number | null>>(sheet, { header: 1, defval: null });
  const wageHeading = rows.findIndex((row) => row.some((cell) =>
    String(cell ?? "").toLowerCase().includes("annual growth in compensation per")
  ));
  if (wageHeading < 0) return;
  const wageColumn = rows[wageHeading]!.findIndex((cell) => String(cell ?? "").toLowerCase().includes("annual growth in compensation per"));
  const currentRoundHeader = rows.findIndex((row, rowIndex) =>
    rowIndex > wageHeading && row.slice(wageColumn).some((cell) => String(cell ?? "").trim().toLowerCase() === roundLabel)
  );
  if (currentRoundHeader < 0) return;
  const meanColumn = rows[currentRoundHeader]!.findIndex((cell, column) =>
    column >= wageColumn && String(cell ?? "").trim().toLowerCase() === roundLabel
  );
  const targetColumn = meanColumn - 2;
  if (meanColumn < 0 || targetColumn < 0) return;
  const pointsByTarget: Record<string, RawPoint> = {};
  for (const row of rows.slice(currentRoundHeader + 1)) {
    const target = String(row[targetColumn] ?? "").trim();
    const rawValue = row[meanColumn];
    // Blank Excel cells become 0 when passed through Number(null). Ignore
    // those rows so a later empty previous-survey horizon cannot overwrite a
    // valid forecast with a fabricated zero.
    if (rawValue === null || rawValue === undefined || String(rawValue).trim() === "") continue;
    const value = Number(typeof rawValue === "string" ? rawValue.replace("%", "").trim() : rawValue);
    if (!/^\d{4}$/.test(target) || !Number.isFinite(value)) continue;
    pointsByTarget[target] = { date: `${year}-${String((quarter - 1) * 3 + 1).padStart(2, "0")}-01`, value };
  }
  // The annex's final annual target is the longer-term horizon (e.g. 2030 in
  // early 2026 rounds and 2031 in Q4 2026). Do not treat the third calendar
  // year as long term; the report's Table 1 remains authoritative when it has
  // already supplied an explicit long-term value for this round.
  const annualTargets = Object.keys(pointsByTarget).sort((left, right) => Number(left) - Number(right));
  for (const target of ["2026", "2027", "2028"] as const) {
    const point = pointsByTarget[target];
    const key = `SPF_WAGE_TARGET_${target}`;
    if (point && !output[key]!.some((existing) => existing.date === point.date)) output[key]!.push(point);
  }
  const longTerm = annualTargets.at(-1) ? pointsByTarget[annualTargets.at(-1)!] : undefined;
  if (longTerm && !output.SPF_WAGE_TARGET_LT!.some((existing) => existing.date === longTerm.date)) output.SPF_WAGE_TARGET_LT!.push(longTerm);
}

async function fillFromDetailedRound(round: string, origin: URL, output: Record<string, RawPoint[]>) {
  const match = round.match(/^(\d{4})q([1-4])$/)!;
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  const response = await fetch(new URL(`table_3_${round}.en.html`, origin), {
    headers: { Accept: "text/html", "User-Agent": "macro-economy-tracker/1.0" },
  });
  if (!response.ok) return;
  const $ = load(await response.text());
  const date = `${year}-${String((quarter - 1) * 3 + 1).padStart(2, "0")}-01`;
  let component: "HICP" | "CORE" | "GDP" | "UNEMP" | null = null;
  $("h1,h2,h3,table").each((_, element) => {
    const tag = (element as { tagName?: string }).tagName?.toLowerCase();
    const text = $(element).text().replace(/\s+/g, " ").trim();
    const lower = text.toLowerCase();
    if (tag !== "table") {
      if (lower.includes("core hicp") || lower.includes("core inflation")) component = "CORE";
      else if (lower.includes("hicp inflation")) component = "HICP";
      else if (lower.includes("real gdp growth")) component = "GDP";
      else if (lower.includes("unemployment rate")) component = "UNEMP";
      return;
    }
    if (!component || !lower.includes("mean point estimate")) return;
    const rows = $(element).find("tr").toArray();
    const forecastRow = rows.find((row) => $(row).text().replace(/\s+/g, " ").toLowerCase().includes("mean point estimate"));
    if (!forecastRow) return;
    const values = $(forecastRow).find("th,td").toArray().map((cell) => $(cell).text().trim());
    const rowIndex = rows.indexOf(forecastRow);
    const header = rows.slice(0, rowIndex).reverse().map((row) =>
      $(row).find("th,td").toArray().map((cell) => $(cell).text().trim())
    ).find((cells) => cells.some((cell) => /^\d{4}$/.test(cell)));
    if (!header) return;
    const valueOffset = header.length === values.length ? 0 : 1;
    for (const target of ["2026", "2027", "2028", "LT"] as const) {
      const column = target === "LT"
        ? header.map((cell) => /^\d{4}$/.test(cell)).lastIndexOf(true)
        : header.findIndex((cell) => cell === target);
      if (column < 0) continue;
      const valueIndex = target === "LT" ? values.length - 1 : column + valueOffset;
      const value = Number(values[valueIndex]?.replace("%", ""));
      if (!Number.isFinite(value)) continue;
      const key = `SPF_${component}_TARGET_${target}`;
      if (!output[key]!.some((point) => point.date === date)) output[key]!.push({ date, value });
    }
  });
}


/* ============================================================
 * HICP SPF FETCHERS
 * ============================================================
 */

/**
 * Current-year HICP inflation forecast.
 *
 * Uses the ECB annual P9M series currently used by the project
 * for the calendar-year/current-year SPF component.
 */
export async function fetchEcbSpfHicpCurrentYear(): Promise<RawPoint[]> {
  return fetchEcbSpfSeries("SPF_HICP_CURRENT_YEAR");
}


/**
 * HICP inflation expectation 1 year ahead.
 */
export async function fetchEcbSpfHicp1y(): Promise<RawPoint[]> {
  return fetchEcbSpfSeries("SPF_HICP_P12M");
}


/**
 * HICP inflation expectation 2 years ahead.
 *
 * Uses the ECB P24M series.
 */
export async function fetchEcbSpfHicp2y(): Promise<RawPoint[]> {
  return fetchEcbSpfSeries("SPF_HICP_P24M");
}


/**
 * Long-term HICP inflation expectation.
 */
export async function fetchEcbSpfHicpLongTerm(): Promise<RawPoint[]> {
  return fetchEcbSpfSeries("SPF_HICP_LT");
}


/* ============================================================
 * EXISTING SERIES FETCHERS
 * ============================================================
 */

/**
 * Core inflation expectation 1 year ahead.
 */
export async function fetchEcbSpfCore1y(): Promise<RawPoint[]> {
  return fetchEcbSpfSeries("SPF_CORE_P12M");
}


/**
 * Labour-cost / wage-growth assumption 1 year ahead.
 */
export async function fetchEcbSpfWageExpectation(): Promise<RawPoint[]> {
  return fetchEcbSpfSeries("SPF_ASSU_LAB_P12M");
}


/* ============================================================
 * GENERIC SPF FETCHER
 * ============================================================
 */

export async function fetchEcbSpfSeries(
  series: EcbSpfSeries
): Promise<RawPoint[]> {
  const path = SPF_PATHS[series];

  if (!path) {
    throw new Error(`ECB SPF series path not configured: ${series}`);
  }

  // SPF_PATHS stores full ECB series keys such as
  // SPF.M.U2.HICP.POINT.P12M.Q.AVG. The REST endpoint expects the
  // dataflow (SPF) as one path segment and the remaining series key
  // as the next segment.
  const prefix = "SPF.";
  const seriesKey = path.startsWith(prefix)
    ? path.slice(prefix.length)
    : path;

  const url =
    `${BASE}/SPF/${encodeURIComponent(seriesKey)}?format=csvdata`;

  const res = await fetch(url, {
    headers: {
      Accept: "text/csv",
      "User-Agent": "macro-economy-tracker/1.0",
    },
  });

  if (!res.ok) {
    throw new Error(
      `ECB SPF ${series} ${res.status} ${res.statusText}`
    );
  }

  const text = await res.text();

  const points = parseEcbCsv(text);

  if (!points.length) {
    throw new Error(
      `ECB SPF ${series} returned no observations`
    );
  }

  return points;
}


/* ============================================================
 * ECB CONSUMER EXPECTATIONS SURVEY (CES)
 * ============================================================
 */

/**
 * ECB Consumer Expectations Survey:
 * 1-year inflation expectation.
 */
export async function fetchEcbCesInflation1y(): Promise<RawPoint[]> {
  // ECB EA11 observations begin in April 2022. The same survey's published
  // EA6 aggregate provides the earlier history through December 2023. Join
  // at the EA11 launch date so the current aggregate takes precedence and no
  // duplicate or synthetic observations are introduced.
  const [ea6, ea11] = await Promise.all([
    fetchEcbCes("CES.M.Z17.ALL.T.C1120.NUM_VAR.WM", "1Y EA6 history"),
    fetchEcbCes("CES.M.Z18.ALL.T.C1120.NUM_VAR.WM", "1Y EA11"),
  ]);
  return [...ea6.filter((point) => point.date < "2022-04-01"), ...ea11]
    .sort((left, right) => left.date.localeCompare(right.date));
}


/**
 * ECB Consumer Expectations Survey:
 * 3-year inflation expectation.
 */
export async function fetchEcbCesInflation3y(): Promise<RawPoint[]> {
  return fetchEcbCes(
    "CES.M.Z18.ALL.T.C1220.NUM_VAR.WM",
    "3Y"
  );
}


/**
 * ECB Consumer Expectations Survey:
 * 5-year inflation expectation.
 */
export async function fetchEcbCesInflation5y(): Promise<RawPoint[]> {
  return fetchEcbCes(
    "CES.M.Z18.ALL.T.E2020.NUM_VAR.WM",
    "5Y"
  );
}


/**
 * Generic ECB CES fetcher.
 */
async function fetchEcbCes(
  path: string,
  label: string
): Promise<RawPoint[]> {
  // SPF_PATHS stores full ECB series keys such as
  // SPF.M.U2.HICP.POINT.P12M.Q.AVG. The REST endpoint expects the
  // dataflow (SPF) as one path segment and the remaining series key
  // as the next segment.
  const prefix = "CES.";
  const seriesKey = path.startsWith(prefix)
    ? path.slice(prefix.length)
    : path;

  const url =
    `${BASE}/CES/${encodeURIComponent(seriesKey)}?format=csvdata`;

  const res = await fetch(url, {
    headers: {
      Accept: "text/csv",
      "User-Agent": "macro-economy-tracker/1.0",
    },
  });

  if (!res.ok) {
    throw new Error(
      `ECB CES ${label} ${res.status} ${res.statusText}`
    );
  }

  const text = await res.text();

  const points = parseEcbCsv(text);

  if (!points.length) {
    throw new Error(
      `ECB CES ${label} returned no observations`
    );
  }

  return points;
}


/* ============================================================
 * ECB CSV PARSER
 * ============================================================
 */

function parseEcbCsv(text: string): RawPoint[] {
  const trimmed = text.trim();

  if (!trimmed) {
    return [];
  }

  const lines = trimmed.split(/\r?\n/);

  if (lines.length < 2) {
    return [];
  }

  const header = parseCsvLine(lines[0]!.replace(/^\uFEFF/, ""));

  const periodIdx = header.indexOf("TIME_PERIOD");
  const valueIdx = header.indexOf("OBS_VALUE");

  if (periodIdx < 0 || valueIdx < 0) {
    throw new Error(
      "ECB CSV missing TIME_PERIOD/OBS_VALUE"
    );
  }

  const points: RawPoint[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    if (!line) {
      continue;
    }

    const cols = parseCsvLine(line);

    const period = cols[periodIdx]?.trim();
    const rawValue = cols[valueIdx]?.trim();

    if (!period || !rawValue) {
      continue;
    }

    const value = Number(rawValue);

    if (!Number.isFinite(value)) {
      continue;
    }

    const date = ecbPeriodToDate(period);

    if (!date) {
      continue;
    }

    points.push({
      date,
      value,
    });
  }

  /*
   * Protect against duplicate observations for the same date.
   *
   * If duplicates exist, the last observation wins.
   */
  const byDate = new Map<string, RawPoint>();

  for (const point of points) {
    byDate.set(point.date, point);
  }

  return [...byDate.values()].sort(
    (a, b) => a.date.localeCompare(b.date)
  );
}


/* ============================================================
 * CSV LINE PARSER
 * ============================================================
 */

function parseCsvLine(line: string): string[] {
  const out: string[] = [];

  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;

    if (ch === '"') {
      /*
       * CSV escaped quote:
       * ""
       */
      if (
        quoted &&
        line[i + 1] === '"'
      ) {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }

      continue;
    }

    if (ch === "," && !quoted) {
      out.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  out.push(current);

  return out;
}


/* ============================================================
 * ECB PERIOD → DATE
 * ============================================================
 */

function ecbPeriodToDate(
  period: string
): string | null {
  /*
   * Monthly:
   * 2026-08
   */
  const monthly = period.match(
    /^(\d{4})-(\d{2})$/
  );

  if (monthly) {
    return `${monthly[1]}-${monthly[2]}-01`;
  }

  /*
   * Quarterly:
   * 2026-Q1
   * 2026Q1
   */
  const quarterly = period.match(
    /^(\d{4})-?Q([1-4])$/i
  );

  if (quarterly) {
    const year = quarterly[1]!;
    const quarter = Number(quarterly[2]);

    const month =
      (quarter - 1) * 3 + 1;

    return `${year}-${String(month).padStart(2, "0")}-01`;
  }

  /*
   * Annual:
   * 2026
   */
  if (/^\d{4}$/.test(period)) {
    return `${period}-01-01`;
  }

  return null;
}
