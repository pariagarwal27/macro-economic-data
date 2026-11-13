import { getClient } from "@/db";
import { mapInvestingEvent } from "@/catalog/investing-map";
import { parseInvestingNumber } from "@/ingest/investing-calendar";

const CURRENCIES: Record<string, string> = {
  USD: "US", GBP: "UK", EUR: "EA", JPY: "JP", AUD: "AU",
  NZD: "NZ", CAD: "CA", CHF: "CH", CNY: "CN",
};

type SourceEvent = {
  id?: unknown; time?: unknown; currency?: unknown; impact?: unknown;
  title?: unknown; forecast?: unknown; previous?: unknown; actual?: unknown;
  period?: unknown;
};

const SHOWMYTRADES_SERIES_METRICS: Record<string, string> = {
  "usd-nonfarm-payrolls": "us-payrolls-level",
  "usd-unemployment-rate": "us-unemployment",
  "usd-average-hourly-earnings-mom": "us-ahe-mom",
  "usd-average-hourly-earnings-yoy": "us-ahe",
  "usd-cpi-mom": "us-cpi-mom",
  "usd-cpi-yoy": "us-cpi-yoy",
  "usd-core-cpi-mom": "us-core-cpi-mom",
  "usd-core-cpi-yoy": "us-core-cpi-yoy",
  "usd-ppi-mom": "us-ppi-final-demand-mom",
  "usd-ppi-yoy": "us-ppi-final-demand",
  "usd-core-ppi-mom": "us-ppi-core-mom",
  "usd-core-ppi-yoy": "us-ppi-core",
  "usd-jolts-job-openings": "us-jolts-openings",
  "usd-gdp-annualized": "us-gdp-real",
  "usd-core-pce-mom": "us-core-pce-mom",
  "usd-core-pce-yoy": "us-core-pce-yoy",
  "usd-pce-mom": "us-pce-mom",
  "usd-pce-yoy": "us-pce-yoy",
  "usd-private-payrolls": "us-adp-change",
  "usd-participation-rate": "us-participation",
  "usd-retail-sales-mom": "us-retail-sales-total",
  "usd-retail-sales-ex-autos-mom": "us-retail-sales-ex-auto",
  "gbp-ilo-unemployment-rate": "uk-unemployment",
  "gbp-employment-change": "uk-employment-level",
  "gbp-average-earnings-excl-bonus": "uk-awe-regular-yoy",
  "gbp-average-earnings-incl-bonus": "uk-awe-total-yoy",
  "eur-gross-domestic-product-sa-qoq": "ea-gdp-qoq",
  "eur-gross-domestic-product-sa-yoy": "ea-gdp-yoy",
  "eur-unemployment-rate": "ea-unemployment",
  "eur-inflation-rate-yoy": "ea-hicp-yoy",
  "eur-inflation-rate-mom": "ea-hicp-mom",
  "eur-core-inflation-rate-yoy": "ea-core-hicp-yoy",
  "eur-industrial-production-sa-mom": "ea-industrial-production",
  "eur-retail-sales-mom": "ea-retail-sales-mom",
  "gbp-retail-sales-mom": "uk-retail-sales-total-ex-fuel",
  "gbp-retail-sales-yoy": "uk-retail-sales-total-yoy",
  "gbp-retail-sales-ex-fuel-mom": "uk-retail-sales-ex-fuel",
  "gbp-retail-sales-ex-fuel-yoy": "uk-retail-sales-ex-fuel-yoy",
};

/** Map feed series to the current dashboard catalog, including existing stored rows. */
export function resolveShowMyTradesMetric(metricId: string | null, eventName: string) {
  const normalizedName = eventName.toLowerCase();
  if (normalizedName.includes("excluding bonus") || normalizedName.includes("excl bonus")) return "uk-awe-regular-yoy";
  if (normalizedName.includes("including bonus") || normalizedName.includes("incl bonus")) return "uk-awe-total-yoy";
  if (metricId === "us-nfp") return "us-payrolls-level";
  if (metricId === "us-retail-sales") return "us-retail-sales-total";
  if (metricId === "uk-retail-sales-mom") return normalizedName.includes("ex-fuel") ? "uk-retail-sales-ex-fuel" : "uk-retail-sales-total-ex-fuel";
  if (metricId === "uk-retail-sales") {
    if (normalizedName.includes("ex-fuel")) return normalizedName.includes("yoy") ? "uk-retail-sales-ex-fuel-yoy" : "uk-retail-sales-ex-fuel";
    return normalizedName.includes("mom") ? "uk-retail-sales-total-ex-fuel" : "uk-retail-sales-total-yoy";
  }
  return metricId;
}

function showMyTradesMetricId(id: string, title: string, currency: string, country: string) {
  const seriesId = id.split(".", 1)[0];
  return SHOWMYTRADES_SERIES_METRICS[seriesId] ?? mapInvestingEvent({ eventName: title, currency, country });
}

export type ShowMyTradesEvent = {
  id: string;
  country: string;
  currency: string;
  eventName: string;
  releasedAt: string;
  importance: number;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  rawActual: string | null;
  rawForecast: string | null;
  rawPrevious: string | null;
  periodLabel: string | null;
  metricId: string | null;
};

function rawValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : null;
}

function parseShowMyTradesValue(value: string | null) {
  return parseInvestingNumber(value?.replace(/[$£€¥]/g, "").trim() ?? null);
}

export function normalizeShowMyTradesEvent(row: SourceEvent): ShowMyTradesEvent | null {
  if (typeof row.id !== "string" || typeof row.time !== "string" || typeof row.currency !== "string" || typeof row.title !== "string") return null;
  const currency = row.currency.toUpperCase();
  const country = CURRENCIES[currency];
  const releasedAt = new Date(row.time);
  if (!country || !Number.isFinite(releasedAt.getTime())) return null;
  const rawActual = rawValue(row.actual);
  const rawForecast = rawValue(row.forecast);
  const rawPrevious = rawValue(row.previous);
  const importance = row.impact === "high" ? 3 : row.impact === "medium" ? 2 : row.impact === "low" ? 1 : 0;
  return {
    id: row.id,
    country,
    currency,
    eventName: row.title,
    releasedAt: releasedAt.toISOString(),
    importance,
    actual: parseShowMyTradesValue(rawActual),
    forecast: parseShowMyTradesValue(rawForecast),
    previous: parseShowMyTradesValue(rawPrevious),
    rawActual,
    rawForecast,
    rawPrevious,
    periodLabel: typeof row.period === "string" && row.period ? row.period : null,
    metricId: showMyTradesMetricId(row.id, row.title, currency, country),
  };
}

export async function fetchShowMyTradesCalendar(now = new Date(), fetcher: typeof fetch = fetch) {
  const url = new URL("https://showmytrades.com/api/public/calendar/v1");
  url.searchParams.set("impact", "high,medium,low");
  url.searchParams.set("days", "8");
  const response = await fetcher(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`ShowMyTrades calendar returned HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { events?: unknown }).events)) {
    throw new Error("ShowMyTrades calendar response is invalid");
  }
  const start = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + 8 * 86400000);
  const events = (payload as { events: SourceEvent[] }).events
    .map(row => row && typeof row === "object" ? normalizeShowMyTradesEvent(row) : null)
    .filter((event): event is ShowMyTradesEvent => event != null && event.releasedAt >= start.toISOString() && event.releasedAt < end.toISOString());
  if (!events.length) throw new Error("ShowMyTrades returned no calendar events in the requested window");
  return { events, start: start.toISOString(), end: end.toISOString() };
}

export async function refreshShowMyTradesCalendar(now = new Date()) {
  const { events, start, end } = await fetchShowMyTradesCalendar(now);
  const importedAt = now.toISOString();
  const sql = `INSERT INTO calendar_events (source,country,currency,event_name,importance,released_at,actual,forecast,previous,raw_actual,raw_forecast,raw_previous,period_label,metric_id,dump_file,imported_at) VALUES ('showmytrades',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source,country,event_name,released_at) DO UPDATE SET currency=excluded.currency,importance=excluded.importance,actual=excluded.actual,forecast=excluded.forecast,previous=excluded.previous,raw_actual=excluded.raw_actual,raw_forecast=excluded.raw_forecast,raw_previous=excluded.raw_previous,period_label=excluded.period_label,metric_id=excluded.metric_id,dump_file=excluded.dump_file,imported_at=excluded.imported_at`;
  const statements = [
    { sql: "DELETE FROM calendar_events WHERE source = 'showmytrades' AND released_at >= ? AND released_at < ?", args: [start, end] },
    ...events.map(event => ({ sql, args: [event.country, event.currency, event.eventName, event.importance, event.releasedAt, event.actual, event.forecast, event.previous, event.rawActual, event.rawForecast, event.rawPrevious, event.periodLabel, event.metricId, "showmytrades-public-calendar-api", importedAt] })),
  ];
  await getClient().batch(statements, "write");
  return { rows: events.length, forecasts: events.filter(event => event.forecast != null || event.rawForecast != null).length, mapped: events.filter(event => event.metricId != null).length, importedAt, start, end };
}
