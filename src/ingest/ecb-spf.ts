import type { RawPoint } from "./transforms";

const BASE = "https://data-api.ecb.europa.eu/service/data";

export type EcbSpfSeries =
  // HICP inflation expectations
  | "SPF_HICP_CURRENT_YEAR"
  | "SPF_HICP_P12M"
  | "SPF_HICP_P24M"
  | "SPF_HICP_LT"

  // Existing core inflation series
  | "SPF_CORE_P12M"

  // Existing wage/labour-cost assumption
  | "SPF_ASSU_LAB_P12M";

const SPF_PATHS: Record<EcbSpfSeries, string> = {
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
};


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
  return fetchEcbCes(
    "CES.M.Z18.ALL.T.C1120.NUM_VAR.WM",
    "1Y"
  );
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