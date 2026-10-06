import type { RawPoint } from "./transforms";

const BEA_URL = "https://apps.bea.gov/api/data";

type BeaRow = {
  LineNumber?: string;
  DataValue?: string;
  TimePeriod?: string;
};

/**
 * Official BEA API — GDP, PCE, personal income, etc.
 *
 * Includes retry/backoff handling for BEA HTTP 429 rate limits.
 *
 * Free API key:
 * https://apps.bea.gov/API/signup/
 */
export async function fetchBeaNipa(
  tableName: string,
  lineNumber: string | number,
  opts?: {
    frequency?: "Q" | "M" | "A";
    year?: string;
  }
): Promise<RawPoint[]> {
  const apiKey = process.env.BEA_API_KEY;

  if (!apiKey) {
    throw new Error("BEA_API_KEY required for live BEA pulls");
  }

  const params = new URLSearchParams({
    UserID: apiKey,
    method: "GetData",
    DataSetName: "NIPA",
    TableName: tableName,
    Frequency: opts?.frequency ?? "M",
    Year:
      opts?.year ??
      `${new Date().getUTCFullYear() - 1},${new Date().getUTCFullYear()}`,
    ResultFormat: "JSON",
  });

  const json = await fetchBeaJson(params);

  const rows = json.BEAAPI?.Results?.Data ?? [];
  const want = String(lineNumber);

  const points: RawPoint[] = [];

  for (const row of rows) {
    if (String(row.LineNumber) !== want) continue;

    const value = Number(row.DataValue?.replace(/,/g, ""));

    if (!Number.isFinite(value)) continue;

    const date = beaTimeToDate(row.TimePeriod);

    if (!date) continue;

    points.push({
      date,
      value,
    });
  }

  return points.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Fetch the complete BEA history in 5-year windows.
 *
 * BEA can rate-limit repeated API requests, so requests are intentionally
 * paced and each request automatically retries after HTTP 429.
 */
export async function fetchBeaNipaFullHistory(
  tableName: string,
  lineNumber: string | number,
  opts: {
    frequency?: "Q" | "M" | "A";
    startYear?: number;
    endYear?: number;
  } = {}
): Promise<RawPoint[]> {
  const frequency = opts.frequency ?? "M";
  const startYear =
    opts.startYear ?? (frequency === "M" ? 1959 : 1929);
  const endYear = opts.endYear ?? new Date().getFullYear();

  const out: RawPoint[] = [];

  for (let y = startYear; y <= endYear; y += 5) {
    const years = Array.from(
      {
        length: Math.min(5, endYear - y + 1),
      },
      (_, i) => String(y + i)
    ).join(",");

    console.log(
      `[bea] ${tableName}:${lineNumber} ${frequency} ${years}`
    );

    const rows = await fetchBeaRowsDirect(
      tableName,
      frequency,
      years
    );

    for (const row of rows) {
      if (String(row.LineNumber) !== String(lineNumber)) continue;

      const value = Number(row.DataValue?.replace(/,/g, ""));
      const date = beaTimeToDate(row.TimePeriod);

      if (Number.isFinite(value) && date) {
        out.push({
          date,
          value,
        });
      }
    }

    // Give BEA a little breathing room before the next request.
    if (y + 5 <= endYear) {
      await sleep(750);
    }
  }

  const byDate = new Map(
    out.map((point) => [point.date, point])
  );

  return [...byDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}

/**
 * Direct BEA request for a group of years.
 */
async function fetchBeaRowsDirect(
  tableName: string,
  frequency: "Q" | "M" | "A",
  years: string
): Promise<BeaRow[]> {
  const apiKey = process.env.BEA_API_KEY;

  if (!apiKey) {
    throw new Error(
      "BEA_API_KEY required for official BEA pulls"
    );
  }

  const params = new URLSearchParams({
    UserID: apiKey,
    method: "GetData",
    DataSetName: "NIPA",
    TableName: tableName,
    Frequency: frequency,
    Year: years,
    ResultFormat: "JSON",
  });

  const json = await fetchBeaJson(params);

  return json.BEAAPI?.Results?.Data ?? [];
}

/**
 * BEA HTTP request with retry/backoff handling.
 *
 * 429 responses are retried automatically.
 */
async function fetchBeaJson(
  params: URLSearchParams
): Promise<BeaResponse> {
  const maxAttempts = 6;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;

    try {
      res = await fetch(`${BEA_URL}?${params}`, {
        headers: {
          "User-Agent":
            "macro-economy-tracker/1.0",
          Accept: "application/json",
        },
      });
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }

      const delay = backoffDelay(attempt);

      console.warn(
        `[bea] network error; retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`
      );

      await sleep(delay);
      continue;
    }

    if (res.ok) {
      const json = (await res.json()) as BeaResponse;

      const err = json.BEAAPI?.Error;

      if (err?.ErrorDetail || err?.APIErrorDescription) {
        throw new Error(
          `BEA: ${
            err.APIErrorDescription ??
            err.ErrorDetail?.Description ??
            "Unknown BEA API error"
          }`
        );
      }

      return json;
    }

    if (res.status === 429) {
      if (attempt === maxAttempts) {
        throw new Error(
          `BEA HTTP 429 after ${maxAttempts} attempts`
        );
      }

      const retryAfter = getRetryAfterMs(res);
      const delay =
        retryAfter ?? backoffDelay(attempt);

      console.warn(
        `[bea] HTTP 429; retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`
      );

      await sleep(delay);
      continue;
    }

    if (res.status >= 500 && attempt < maxAttempts) {
      const delay = backoffDelay(attempt);

      console.warn(
        `[bea] HTTP ${res.status}; retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`
      );

      await sleep(delay);
      continue;
    }

    throw new Error(`BEA HTTP ${res.status}`);
  }

  throw new Error("BEA request failed");
}

/**
 * Exponential backoff:
 *
 * attempt 1 → 2s
 * attempt 2 → 4s
 * attempt 3 → 8s
 * attempt 4 → 16s
 * attempt 5 → 32s
 */
function backoffDelay(attempt: number): number {
  const base = 2000;
  const max = 30000;

  const exponential = Math.min(
    base * 2 ** (attempt - 1),
    max
  );

  // Small jitter prevents synchronized retries.
  const jitter = Math.floor(Math.random() * 500);

  return exponential + jitter;
}

/**
 * Respect BEA's Retry-After header when supplied.
 */
function getRetryAfterMs(res: Response): number | null {
  const value = res.headers.get("retry-after");

  if (!value) return null;

  const seconds = Number(value);

  if (Number.isFinite(seconds)) {
    return Math.max(1000, seconds * 1000);
  }

  const date = Date.parse(value);

  if (Number.isFinite(date)) {
    return Math.max(1000, date - Date.now());
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface BeaResponse {
  BEAAPI?: {
    Error?: {
      APIErrorDescription?: string;
      ErrorDetail?: {
        Description?: string;
      };
    };
    Results?: {
      Data?: Array<{
        LineNumber?: string;
        DataValue?: string;
        TimePeriod?: string;
      }>;
    };
  };
}

function beaTimeToDate(
  period?: string
): string | null {
  if (!period) return null;

  // 2024Q1
  const q = period.match(
    /^(\d{4})Q([1-4])$/
  );

  if (q) {
    const month = String(
      (Number(q[2]) - 1) * 3 + 1
    ).padStart(2, "0");

    return `${q[1]}-${month}-01`;
  }

  // 2024M01
  const m = period.match(
    /^(\d{4})M(\d{2})$/
  );

  if (m) {
    return `${m[1]}-${m[2]}-01`;
  }

  // 2024
  if (/^\d{4}$/.test(period)) {
    return `${period}-01-01`;
  }

  return null;
}